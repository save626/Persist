/**
 * 解析结果：成功带值，失败带一条能直接展示给用户看的中文原因。
 *
 * 服务端与前端共用同一套解析函数与返回形状，避免「服务端说合法、前端说非法」。
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string }
