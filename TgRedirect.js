/**
 * Egern: t.me → 第三方 Telegram 客户端重定向
 *
 * 基于 IBL3ND/module 的 TgRedirect.js(panda𝕏 模块),新增 Regram 支持。
 * Regram 的 URL scheme 取自官方 Release v13.0-b34619 编译后 Info.plist:
 * 自定义组注册了 ['regram', 'rg', 'sg'],此处用 regram 避免与 Swiftgram 的 sg 冲突。
 *
 * Regram 装在 LiveContainer(guest app 的自定义 scheme 不注册到系统),
 * 因此先拼出 regram:// 链接做 base64,再走 LiveContainer 转发:
 *   livecontainer://livecontainer-launch?bundle-name=<bid>&open-url=<base64>
 * 接口依据 LiveContainer 源码 LCAppListView.swift / LCWebView.swift。
 *
 * 说明：
 * - 客户端选择通过模块的 env_schema 写入模块级 env
 * - 脚本直接读取 ctx.env.CLIENT
 */

const SCHEME = {
  Telegram: "tg",
  Nagram: "tg",
  Swiftgram: "sg",
  Turrit: "turrit",
  iMe: "ime",
  Nicegram: "ng",
  Lingogram: "lingo",
  Regram: "regram",
};

// 寄宿在 LiveContainer 里的客户端:名称 -> guest 的 relativeBundlePath。
// 注意是 LC 的包目录名(bundle id + ".app",即详情页"包文件名"),不是 bundle id
// 也不是容器 UUID。LC 更新 guest 时复用该目录名,因此更新 Regram 不需要改这里。
const LC_HOSTED = {
  Regram: "app.swiftgram.ios.app",
};

const LC_SCHEME = "livecontainer";

// 标准字母表 base64(含 UTF-8 编码),不依赖运行时 btoa/TextEncoder。
// LiveContainer 端用 Data(base64Encoded:) 解码,必须用标准字母表,不能用 base64url。
function utf8b64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000)
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
  }
  const T =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += T[b0 >> 2];
    if (b1 === undefined) {
      out += T[(b0 & 3) << 4] + "==";
      break;
    }
    out += T[((b0 & 3) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += T[(b1 & 15) << 2] + "=";
      break;
    }
    out += T[((b1 & 15) << 2) | (b2 >> 6)] + T[b2 & 63];
  }
  return out;
}

function qval(qs, key) {
  if (!qs) return "";
  const re = new RegExp(
    "(?:^|&)" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)",
  );
  const m = qs.match(re);
  return m ? decodeURIComponent(m[1]) : "";
}

function deeplink(s, path, qs) {
  const p = path.split("/").filter(Boolean);
  if (!p[0]) return "";

  if (p[0][0] === "+") {
    return `${s}://join?invite=${encodeURIComponent(p[0].slice(1))}`;
  }
  if (p[0] === "joinchat" && p[1]) {
    return `${s}://join?invite=${encodeURIComponent(p[1])}`;
  }
  if (p[0] === "addstickers" && p[1]) {
    return `${s}://addstickers?set=${encodeURIComponent(p[1])}`;
  }
  if (p[0] === "share" && p[1] === "url") {
    return `${s}://msg_url?url=${encodeURIComponent(qval(qs, "url"))}&text=${encodeURIComponent(qval(qs, "text"))}`;
  }
  if (p[1] && /^\d+$/.test(p[1])) {
    return `${s}://resolve?domain=${encodeURIComponent(p[0])}&post=${encodeURIComponent(p[1])}`;
  }
  return `${s}://resolve?domain=${encodeURIComponent(p[0])}`;
}

export default async function (ctx) {
  const url = ctx.request.url;
  const m = url.match(/^https?:\/\/(?:t\.me|telegram\.me)\/(.+)$/i);
  if (!m) return;

  const client = (ctx.env?.CLIENT || "Telegram").trim();

  // 选官方 Telegram 直接放行，不重定向
  if (client === "Telegram") return;

  const scheme = SCHEME[client] || "tg";

  let tail = m[1];
  if (tail.startsWith("s/")) tail = tail.slice(2);

  const qi = tail.indexOf("?");
  const path = qi < 0 ? tail : tail.slice(0, qi);
  const qs = qi < 0 ? "" : tail.slice(qi + 1);

  let loc = deeplink(scheme, path, qs);
  if (!loc) return;

  // LiveContainer 寄宿的客户端:把 deeplink base64 后交给 LC 转发
  const lcBundle = LC_HOSTED[client];
  if (lcBundle) {
    loc = `${LC_SCHEME}://livecontainer-launch?bundle-name=${encodeURIComponent(
      lcBundle,
    )}&open-url=${utf8b64(loc)}`;
  }

  return ctx.respond({
    status: 302,
    headers: {
      Location: loc,
      "Cache-Control": "no-store, no-cache",
    },
    body: "",
  });
}
