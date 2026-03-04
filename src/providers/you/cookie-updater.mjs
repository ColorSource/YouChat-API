import fs from "fs";
import path from "path";
import {Mutex} from "async-mutex";

const configMutex = new Mutex(); // 浜掓枼閿?

const CONFIG_FILE_PATH = path.join(process.cwd(), "src", "config", "provider-config.mjs");

// 浠呭湪 USE_MANUAL_LOGIN 涓?false 涓?ENABLE_AUTO_COOKIE_UPDATE 涓?true 鏃剁敓鏁?
const ENABLE_AUTO_COOKIE_UPDATE = process.env.ENABLE_AUTO_COOKIE_UPDATE === "true";

function unifyQuotesForJSON(str) {
    // 姝ｅ垯鍖归厤 `` `...` ``
    let out = str.replace(/`([^`]*)`/g, (match, p1) => {
        const safe = p1.replace(/"/g, '\\"');
        return `"${safe}"`;
    });
    out = out.replace(/'([^']*)'/g, (match, p1) => {
        const safe = p1.replace(/"/g, '\\"');
        return `"${safe}"`;
    });

    return out;
}


/**
 * cookies 瑙ｆ瀽鍑?DS 涓?DSR
 * @param {Array} cookies 鑾峰彇鍒扮殑 cookie 鏁扮粍
 * @returns {{ ds?: string, dsr?: string }}
 */
function parseDSAndDSR(cookies) {
    let dsValue, dsrValue;
    for (const c of cookies) {
        if (c.name === "DS") {
            dsValue = c.value;
        } else if (c.name === "DSR") {
            dsrValue = c.value;
        }
    }
    return {ds: dsValue, dsr: dsrValue};
}

/**
 * 浠?DS 涓В鏋?email 瀛楁
 * @param {string} dsToken DS cookie
 * @returns {string|null} 杩斿洖 email鎴杗ull
 */
function decodeEmailFromDs(dsToken) {
    try {
        const parts = dsToken.split(".");
        if (parts.length < 2) return null;
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
        return payload.email || null;
    } catch (err) {
        return null;
    }
}

/**
 * cookie 鏁扮粍杞崲 "name=value; name=value"
 * @param {Array} cookies
 * @returns {string}
 */
function cookiesToStringAll(cookies) {
    return cookies.map(c => `${c.name}=${c.value}`).join("; ");
}

/**
 * cookie 杞崲鏁扮粍
 * 姣忎釜瀵硅薄濡?{ name, value }
 * @param {string} cookieStr
 * @returns {Array}
 */
function parseCookieString(cookieStr) {
    return cookieStr.split("; ").map(entry => {
        const [name, value] = entry.split("=", 2);
        return {name, value};
    });
}

/**
 * 鏈湴 configObj.sessions 鏌ユ壘涓庢寚瀹?email 鍖归厤鐨?session锛?
 * @param {object} configObj 瑙ｆ瀽鍚?config
 * @param {string} email 鍖归厤鐨勯偖绠?
 * @returns {{ index: number, oldCookie: string, ds: string, dsr: string } | null}
 */
function findSessionByEmail(configObj, email) {
    if (!Array.isArray(configObj.sessions)) return null;
    for (let i = 0; i < configObj.sessions.length; i++) {
        const cookieStr = configObj.sessions[i].cookie || "";
        const dsMatch = /DS=([^;\s]+)/.exec(cookieStr);
        if (!dsMatch) continue;
        const dsValue = dsMatch[1];
        const dsEmail = decodeEmailFromDs(dsValue);
        if (dsEmail && dsEmail.toLowerCase() === email.toLowerCase()) {
            const dsrMatch = /DSR=([^;\s]+)/.exec(cookieStr);
            const dsrValue = dsrMatch ? dsrMatch[1] : "";
            return {
                index: i,
                oldCookie: cookieStr,
                ds: dsValue,
                dsr: dsrValue
            };
        }
    }
    return null;
}

/**
 * src/config/provider-config.mjs 涓尮閰嶇浉鍚?email 鐨?session锛岃嫢 DS 鎴?DSR 鏈夊彉鍖栵紝鍒欐洿鏂版暣涓?cookie
 * @param {import('playwright').Page} page
 */
export async function updateLocalConfigCookieByEmail(page) {
    if (!ENABLE_AUTO_COOKIE_UPDATE || process.env.USE_MANUAL_LOGIN === "true") {
        return;
    }
    // 灏濊瘯浠?鈥渉ttps://you.com/api/instrumentation鈥?鑾峰彇 cookie
    let cookieStringFromInstrumentation = "";
    try {
        const instrRequest = await page.waitForRequest(
            req => req.url().includes("/api/instrumentation"),
            {timeout: 5000}
        );
        if (instrRequest) {
            cookieStringFromInstrumentation = instrRequest.headers()["cookie"];
        }
    } catch (err) {
    }

    let allCookiesString = "";
    if (cookieStringFromInstrumentation) {
        allCookiesString = cookieStringFromInstrumentation;
    } else {
        // 使用 Playwright context 获取 cookies
        const cookies = await page.context().cookies(["https://you.com"]);
        allCookiesString = cookiesToStringAll(cookies);
    }

    const cookieArray = parseCookieString(allCookiesString);
    const {ds: newDs, dsr: newDsr} = parseDSAndDSR(cookieArray);
    if (!newDs) {
        console.log("DS was not found on the page. Skip update.");
        return;
    }
    const newEmail = decodeEmailFromDs(newDs);
    if (!newEmail) {
        console.log("Cannot decode email from DS. Skip update.");
        return;
    }

    // 浜掓枼鍖?
    await configMutex.runExclusive(async () => {
        try {
            if (!fs.existsSync(CONFIG_FILE_PATH)) {
                console.warn(`Cannot find config file: ${CONFIG_FILE_PATH}`);
                return;
            }
            const raw = fs.readFileSync(CONFIG_FILE_PATH, "utf8");
            // 鍘绘帀 export const config =
            let jsonString = raw.replace(/^export const config\s*=\s*/, "").trim();

            jsonString = unifyQuotesForJSON(jsonString);

            const configObj = JSON.parse(jsonString);

            const found = findSessionByEmail(configObj, newEmail);
            if (!found) {
                console.log(`No matching session found for email=${newEmail}. Skip update.`);
                return;
            }

            if (found.ds === newDs && found.dsr === newDsr) {
                console.log(`DS/DSR unchanged for email=${newEmail}. Skip update.`);
                return;
            }

            configObj.sessions[found.index].cookie = allCookiesString;

            const newFileContent = "export const config = " + JSON.stringify(configObj, null, 4);
            fs.writeFileSync(CONFIG_FILE_PATH, newFileContent, "utf8");

            console.log(`Cookie updated for email=${newEmail}`);
        } catch (err) {
            console.warn("Cookie update failed:", err);
        }
    });
}

/**
 * 闈為樆濉?
 * @param {import('playwright').Page} page
 */
export function updateLocalConfigCookieByEmailNonBlocking(page) {
    // 淇濊瘉寮傛
    setImmediate(() => {
        updateLocalConfigCookieByEmail(page).catch(err =>
            console.error("Cookie update error:", err)
        );
    });
}



