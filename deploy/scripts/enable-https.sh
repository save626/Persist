#!/usr/bin/env bash
# Persist —— 一键启用 HTTPS（证书签发 + Nginx TLS 配置 + 验收）
#
# 幂等：可重复执行。已存在有效证书时跳过签发，只做配置与验收。
# 失败即停：任何一步不通过就中止，绝不 reload 半成品配置。
#
# 前置条件（只有这两条需要用户先在阿里云控制台完成）：
#   1. 云解析 DNS：wpersist.top 与 www.wpersist.top 都有 A 记录 → 本机公网 IP
#   2. 安全组：入方向 443/tcp 已放行
#
# 用法（在服务器上执行）：
#   bash /opt/persist-next/deploy/enable-https.sh
#
# 仓库内位置：deploy/scripts/enable-https.sh（上传到服务器后执行）

set -euo pipefail

DOMAIN="wpersist.top"
ALT_DOMAIN="www.wpersist.top"
WEBROOT="/var/www/certbot"
CERT_NAME="wpersist.top"
CERT_DIR="/etc/letsencrypt/live/${CERT_NAME}"
CONF_DIR="/etc/nginx/conf.d"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
step() { printf '\n%s▶ %s%s\n' "$DIM" "$1" "$RST"; }
ok()   { printf '  %s✓ %s%s\n' "$GRN" "$1" "$RST"; }
warn() { printf '  %s! %s%s\n' "$YLW" "$1" "$RST"; }
die()  { printf '  %s✗ %s%s\n' "$RED" "$1" "$RST"; exit 1; }

[[ "$(id -u)" == "0" ]] || die "必须用 root 执行"

# ---------------------------------------------------------------- 0. 环境自检

step "环境自检"
command -v certbot >/dev/null || die "没有 certbot，先装：yum install -y certbot"
ok "certbot $(certbot --version 2>&1 | awk '{print $2}')"
[[ -d "$WEBROOT" ]] || die "ACME webroot 不存在：$WEBROOT（2026-11-19 已修过，别退回）"
ok "ACME webroot 存在：$WEBROOT"
[[ -d "$CONF_DIR" ]] || die "nginx 配置目录不存在：$CONF_DIR"
for f in persist-tls.conf persist-redirect.conf; do
  [[ -f "${SRC_DIR}/${f}" ]] || die "缺少配置文件：${SRC_DIR}/${f}"
done
ok "TLS 配置模板就绪"

# ---------------------------------------------------------------- 1. DNS 校验

step "DNS 解析校验"

# 服务器上没有 dig/nslookup（2026-11-27 实测），用阿里云 DoH 查 A 记录。
resolve_a() {
  curl -s -m 10 "https://dns.alidns.com/resolve?name=$1&type=A" \
    | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for r in (d.get("Answer") or []):
    if r.get("type") == 1:
        print(r["data"])
'
}

PUBLIC_IP="$(curl -s -m 10 ifconfig.me || true)"
[[ -n "$PUBLIC_IP" ]] || die "取不到本机公网 IP"
ok "本机公网 IP：$PUBLIC_IP"

A_RECORDS="$(resolve_a "$DOMAIN" || true)"
[[ -n "$A_RECORDS" ]] || die "$DOMAIN 没有 A 记录 —— 还没在阿里云云解析加记录？"
if [[ "$A_RECORDS" != *"$PUBLIC_IP"* ]]; then
  die "$DOMAIN 解析到 [$A_RECORDS]，不是本机 [$PUBLIC_IP] —— 记录值填错，或还没生效"
fi
ok "$DOMAIN → $A_RECORDS"

A_ALT="$(resolve_a "$ALT_DOMAIN" || true)"
[[ -n "$A_ALT" ]] || die "$ALT_DOMAIN 没有 A 记录 —— 请在云解析补一条同名 A 记录"
if [[ "$A_ALT" != *"$PUBLIC_IP"* ]]; then
  die "$ALT_DOMAIN 解析到 [$A_ALT]，不是本机 [$PUBLIC_IP]"
fi
ok "$ALT_DOMAIN → $A_ALT"

# ---------------------------------------------------------------- 2. 签发证书

step "证书签发"

need_issue=1
if [[ -f "${CERT_DIR}/fullchain.pem" && -f "${CERT_DIR}/privkey.pem" ]]; then
  # 已有证书：检查 SAN 是否同时覆盖裸域与 www
  SAN="$(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)"
  if [[ "$SAN" == *"$DOMAIN"* && "$SAN" == *"$ALT_DOMAIN"* ]] \
     && openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -checkend 604800 >/dev/null 2>&1; then
    ok "已有证书且 SAN 覆盖两个域名、剩余有效期 > 7 天，跳过签发"
    need_issue=0
  else
    warn "已有证书 SAN 或有效期不满足，重新签发"
  fi
fi

if [[ "$need_issue" == "1" ]]; then
  # ACME HTTP-01 挑战走 80 端口的 /.well-known/acme-challenge/，
  # 此时 redirect 配置还没装，persist.conf（default_server）负责应答 —— 必须先签发再装配置。
  certbot certonly \
    --webroot -w "$WEBROOT" \
    -d "$DOMAIN" -d "$ALT_DOMAIN" \
    --cert-name "$CERT_NAME" \
    --non-interactive --agree-tos \
    --register-unsafely-without-email \
    --keep-until-expiring \
    2>&1 | sed 's/^/  /' || die "certbot 签发失败（上面是 certbot 的原始输出）"
  ok "证书已签发：${CERT_DIR}"
fi

[[ -f "${CERT_DIR}/fullchain.pem" ]] || die "证书文件缺失：${CERT_DIR}/fullchain.pem"
[[ -f "${CERT_DIR}/privkey.pem" ]] || die "私钥缺失：${CERT_DIR}/privkey.pem"
openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -subject -enddate | sed 's/^/  /'
ok "证书文件就位"

# ---------------------------------------------------------------- 3. 装 Nginx 配置

step "Nginx 配置"

BACKUP_DIR="/root/nginx-conf-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
for f in persist.conf persist-tls.conf persist-redirect.conf; do
  [[ -f "${CONF_DIR}/${f}" ]] && cp -a "${CONF_DIR}/${f}" "$BACKUP_DIR/" || true
done
ok "已备份现有配置到 $BACKUP_DIR"

install -m 644 "${SRC_DIR}/persist-tls.conf"      "${CONF_DIR}/persist-tls.conf"
install -m 644 "${SRC_DIR}/persist-redirect.conf" "${CONF_DIR}/persist-redirect.conf"
ok "已安装 persist-tls.conf / persist-redirect.conf"

# 续期 deploy hook：certbot 换证书后必须 reload，否则 nginx 还拿着旧证书
HOOK="${CONF_DIR}/../letsencrypt/renewal-hooks/deploy/reload-nginx.sh"
mkdir -p "$(dirname "$HOOK")"
cat > "$HOOK" <<'HOOKEOF'
#!/usr/bin/env bash
# certbot 续期成功后 reload nginx，让新证书立即生效。
set -e
systemctl reload nginx
HOOKEOF
chmod +x "$HOOK"
ok "已安装续期 deploy hook（reload nginx）"

nginx -t 2>&1 | sed 's/^/  /' || {
  warn "nginx -t 失败，回滚到备份配置"
  for f in persist.conf persist-tls.conf persist-redirect.conf; do
    [[ -f "${BACKUP_DIR}/${f}" ]] && cp -a "${BACKUP_DIR}/${f}" "${CONF_DIR}/${f}"
  done
  rm -f "${CONF_DIR}/persist-tls.conf" "${CONF_DIR}/persist-redirect.conf"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
  die "已回滚，nginx 保持原状"
}
ok "nginx -t 通过"

systemctl reload nginx || die "nginx reload 失败"
ok "nginx 已 reload"

# ---------------------------------------------------------------- 4. 验收

step "验收"

code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/" || echo 000)"
[[ "$code" == "200" ]] || die "https://${DOMAIN}/ 返回 $code（期望 200）"
ok "https://${DOMAIN}/ → 200"

code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/app/" || echo 000)"
[[ "$code" == "200" ]] || warn "https://${DOMAIN}/app/ 返回 $code"
ok "https://${DOMAIN}/app/ → $code"

code="$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/health" || echo 000)"
[[ "$code" == "200" ]] || die "/api/health 返回 $code"
ok "https://${DOMAIN}/api/health → 200"

# HTTP → HTTPS 跳转
loc="$(curl -s -o /dev/null -w '%{redirect_url}' "http://${DOMAIN}/" || true)"
[[ "$loc" == "https://"* ]] || die "http 跳转异常：redirect_url='$loc'"
ok "http → https 跳转正常"

# 证书链与 SAN
SAN="$(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName | tr -d ' ')"
[[ "$SAN" == *"$DOMAIN"* && "$SAN" == *"$ALT_DOMAIN"* ]] || die "证书 SAN 不完整：$SAN"
ok "证书 SAN 覆盖两个域名"

# 页脚备案号
FOOTER="$(curl -s "https://${DOMAIN}/" | grep -o '豫ICP备[0-9]*号' | head -1 || true)"
[[ -n "$FOOTER" ]] || die "首页页脚没有 ICP 备案号"
ok "页脚备案号：$FOOTER"

# www 也要能访问
code="$(curl -s -o /dev/null -w '%{http_code}' "https://${ALT_DOMAIN}/" || echo 000)"
[[ "$code" == "200" ]] || warn "https://${ALT_DOMAIN}/ 返回 $code"
ok "https://${ALT_DOMAIN}/ → $code"

# 续期计时器
systemctl is-enabled certbot-renew.timer >/dev/null 2>&1 || warn "certbot-renew.timer 未 enable"
ok "certbot-renew.timer：$(systemctl is-enabled certbot-renew.timer) / $(systemctl is-active certbot-renew.timer)"

printf '\n%s✓ HTTPS 已启用%s —— https://%s/\n\n' "$GRN" "$RST" "$DOMAIN"
