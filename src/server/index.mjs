import express from "express";
import {createEvent, getGitRevision} from "../utils/cookie-utils.mjs";
import ProviderManager from "../core/provider-manager.mjs";
import {v4 as uuidv4} from "uuid";
import '../network/proxy-agent.mjs';
import {storeImage} from '../storage/image-storage.mjs';
import fetch from 'node-fetch';
import path from 'path';
import geoip from 'geoip-lite';
import RequestLogger from '../logging/request-logger.mjs';

const app = express();
const port = process.env.PORT || 8080;
const validApiKey = process.env.PASSWORD;
const availableModels = [
    // OpenAI
    "gpt_5_2_thinking",
    "gpt_5_2_instant",
    "gpt_5_1_thinking",
    "gpt_5_1_instant",
    "gpt_5",
    "gpt_5_mini",
    "gpt_4_1",
    "gpt_4_1_mini",
    "openai_gpt_oss_120b",
    // Anthropic
    "claude_4_6_opus_thinking",
    "claude_4_6_opus",
    "claude_4_5_opus_thinking",
    "claude_4_5_opus",
    "claude_4_1_opus_thinking",
    "claude_4_1_opus",
    "claude_4_6_sonnet_thinking",
    "claude_4_6_sonnet",
    "claude_4_5_sonnet_thinking",
    "claude_4_5_sonnet",
    "claude_4_sonnet_thinking",
    "claude_4_sonnet",
    "claude_4_5_haiku",
    // Google
    "gemini_3_1_pro",
    "gemini_3_pro",
    "gemini_3_flash",
    "gemini_2_5_pro_preview",
    "gemini_2_5_flash_preview",
    // xAI
    "grok_4_1_fast_reasoning",
    "grok_4_1_fast",
    "grok_4",
    // Alibaba
    "qwen3_235b",
    // DeepSeek
    "deepseek_r1",
    "deepseek_v3",
    // Meta
    "llama4_maverick",
    "llama4_scout",
    // Mistral AI
    "mistral_large_2",
];
const modelMappping = {
    // Anthropic - current model names
    "claude-opus-4-6": "claude_4_6_opus",
    "claude-opus-4-6-20250219": "claude_4_6_opus",
    "claude-opus-4-5": "claude_4_5_opus",
    "claude-opus-4-5-20250120": "claude_4_5_opus",
    "claude-opus-4-1": "claude_4_1_opus",
    "claude-sonnet-4-6": "claude_4_6_sonnet",
    "claude-sonnet-4-6-20250219": "claude_4_6_sonnet",
    "claude-sonnet-4-5": "claude_4_5_sonnet",
    "claude-sonnet-4-5-20250120": "claude_4_5_sonnet",
    "claude-sonnet-4-0": "claude_4_sonnet",
    "claude-sonnet-4-0-20250514": "claude_4_sonnet",
    "claude-haiku-4-5": "claude_4_5_haiku",
    // Anthropic - legacy API names (map to closest current models)
    "claude-3-7-sonnet-latest": "claude_4_6_sonnet_thinking",
    "claude-3-7-sonnet-20250219": "claude_4_6_sonnet",
    "claude-3-5-sonnet-latest": "claude_4_5_sonnet",
    "claude-3-5-sonnet-20241022": "claude_4_5_sonnet",
    "claude-3-5-sonnet-20240620": "claude_4_5_sonnet",
    "claude-3-20240229": "claude_4_6_opus",
    "claude-3-opus-20240229": "claude_4_6_opus",
    "claude-3-sonnet-20240229": "claude_4_sonnet",
    "claude-3-haiku-20240307": "claude_4_5_haiku",
    "claude-2.1": "claude_4_5_haiku",
    "claude-2.0": "claude_4_5_haiku",
    // OpenAI - current model names
    "gpt-5": "gpt_5",
    "gpt-5-mini": "gpt_5_mini",
    "gpt-4.1": "gpt_4_1",
    "gpt-4.1-mini": "gpt_4_1_mini",
    // OpenAI - legacy API names (map to closest current models)
    "gpt-4": "gpt_4_1",
    "gpt-4o": "gpt_5_1_instant",
    "gpt-4-turbo": "gpt_4_1",
    "gpt-4o-mini": "gpt_4_1_mini",
    "o1-preview": "gpt_5_1_thinking",
    "o1-mini": "gpt_5_mini",
    "o3-mini": "gpt_5_mini",
    "openai-o1": "gpt_5_1_thinking",
    // Google
    "gemini-2.5-pro": "gemini_2_5_pro_preview",
    "gemini-2.5-flash": "gemini_2_5_flash_preview",
    "gemini-3-pro": "gemini_3_pro",
    "gemini-3-flash": "gemini_3_flash",
    // xAI
    "grok-4": "grok_4",
    "grok-2": "grok_4",
    // DeepSeek
    "deepseek-r1": "deepseek_r1",
    "deepseek-v3": "deepseek_v3",
    // Meta
    "llama-4-maverick": "llama4_maverick",
    "llama-4-scout": "llama4_scout",
};

function toPublicModelId(model) {
    return String(model || "").replaceAll("_", "-");
}

function resolveModelId(model) {
    if (!model) {
        return model;
    }
    if (modelMappping[model]) {
        return modelMappping[model];
    }
    const normalized = String(model).replaceAll("-", "_");
    if (availableModels.includes(normalized)) {
        return normalized;
    }
    return model;
}

// import src/config/provider-config.mjs
let config;
try {
    const configModule = await import("../config/provider-config.mjs");
    config = configModule.config;
} catch (e) {
    console.error(e);
    console.error("src/config/provider-config.mjs is missing or invalid.");
    process.exit(1);
}

const provider = new ProviderManager(config);
await provider.init(config);

// 鍒濆鍖?SessionManager
const sessionManager = provider.getSessionManager();

// 鍒濆鍖?RequestLogger
const requestLogger = new RequestLogger();

function startSseKeepAlive(res, intervalMs = 8000) {
    let closed = false;
    const sendHeartbeat = () => {
        if (closed || res.writableEnded || res.destroyed) {
            return;
        }
        res.write(": keep-alive\n\n");
    };

    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
    sendHeartbeat();

    const timer = setInterval(sendHeartbeat, intervalMs);
    if (typeof timer.unref === "function") {
        timer.unref();
    }

    return () => {
        if (closed) {
            return;
        }
        closed = true;
        clearInterval(timer);
    };
}

// handle preflight request
app.use((req, res, next) => {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "*");
        res.setHeader("Access-Control-Allow-Headers", "*");
        res.setHeader("Access-Control-Max-Age", "86400");
        res.status(200).end();
    } else {
        next();
    }
});

// openai format model request
app.get("/v1/models", OpenAIApiKeyAuth, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const models = availableModels.map((model) => {
        const publicModelId = toPublicModelId(model);
        return {
            id: publicModelId,
            object: "model",
            created: 1700000000,
            owned_by: "closeai",
            name: publicModelId,
        };
    });
    res.json({object: "list", data: models});
});
// handle openai format model request
app.post("/v1/chat/completions", OpenAIApiKeyAuth, (req, res) => {
    // 鐢ㄤ簬瀛樺偍璇锋眰浣?
    req.rawBody = "";
    req.setEncoding("utf8");
    clientState.setClosed(false);

    // 鎺ユ敹鏁版嵁
    req.on("data", function (chunk) {
        req.rawBody += chunk;
    });

    // 鏁版嵁鎺ユ敹瀹屾瘯鍚庡鐞嗚姹?
    req.on("end", async () => {
        console.log("Handling OpenAI-format request.");
        res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");

        let jsonBody;
        try {
            jsonBody = JSON.parse(req.rawBody);
        } catch (error) {
            res.status(400).json({error: {code: 400, message: "Invalid JSON"}});
            return;
        }
        const isStreamRequest = Boolean(jsonBody.stream);
        let stopSseKeepAlive = () => {
        };

        // 瑙勮寖鍖栨秷鎭?
        jsonBody.messages = await openaiNormalizeMessages(jsonBody.messages);

        console.log("message length: " + jsonBody.messages.length);

        // 灏濊瘯鏄犲皠妯″瀷
        if (jsonBody.model) {
            jsonBody.model = resolveModelId(jsonBody.model);
        }
        if (jsonBody.model && !availableModels.includes(jsonBody.model)) {
            res.json({error: {code: 404, message: "Invalid Model"}});
            return;
        }
        console.log("Using model " + jsonBody.model);

        let selectedSession;
        let releaseSessionCalled = false;
        let completion;
        let cancel;
        let selectedBrowserId;
        // 瀹氫箟閲婃斁浼氳瘽
        const releaseSession = () => {
            if (selectedSession && selectedBrowserId && !releaseSessionCalled) {
                sessionManager.releaseSession(selectedSession, selectedBrowserId);
                console.log(`Released session ${selectedSession} and browser instance ${selectedBrowserId}`);
                releaseSessionCalled = true;
            }
        };

        // 鐩戝惉瀹㈡埛绔叧闂簨浠?
        res.on("close", () => {
            console.log(" > [Client closed]");
            clientState.setClosed(true);
            stopSseKeepAlive();
            if (completion) {
                completion.removeAllListeners();
            }
            if (cancel) {
                cancel();
            }
            releaseSession();
        });

        try {
            if (isStreamRequest) {
                stopSseKeepAlive = startSseKeepAlive(res);
            }
            // 鑾峰彇瀹㈡埛绔?IP
            const clientIpAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            const geo = geoip.lookup(clientIpAddress) || {};
            const locationInfo = `${geo.country || 'Unknown'}-${geo.region || 'Unknown'}-${geo.city || 'Unknown'}`;
            const requestTime = new Date();

            // 鑾峰彇骞堕攣瀹氬彲鐢ㄤ細璇濆拰娴忚鍣ㄥ疄渚?
            const {
                selectedUsername,
                modeSwitched,
                browserInstance
            } = await sessionManager.getSessionByStrategy('round_robin');
            selectedSession = selectedUsername;
            selectedBrowserId = browserInstance.id;
            console.log("Using session " + selectedSession);

            // 璁板綍璇锋眰淇℃伅
            await requestLogger.logRequest({
                time: requestTime,
                ip: clientIpAddress,
                location: locationInfo,
                model: jsonBody.model,
                session: selectedSession
            });

            ({completion, cancel} = await provider.getCompletion({
                username: selectedSession,
                messages: jsonBody.messages,
                browserInstance: browserInstance,
                stream: isStreamRequest,
                proxyModel: jsonBody.model,
                useCustomMode: process.env.USE_CUSTOM_MODE === "true",
                modeSwitched: modeSwitched // 浼犻€掓ā寮忓垏鎹㈡爣蹇?
            }));

            // 鐩戝惉寮€濮嬩簨浠?
            completion.on("start", (id) => {
                if (isStreamRequest) {
                    // 鍙戦€佹秷鎭紑濮?
                    res.write(createEvent(":", "queue heartbeat 114514"));
                    res.write(
                        createEvent("data", {
                            id: id,
                            object: "chat.completion.chunk",
                            created: Math.floor(new Date().getTime() / 1000),
                            model: jsonBody.model,
                            system_fingerprint: "114514",
                            choices: [{
                                index: 0,
                                delta: {role: "assistant", content: ""},
                                logprobs: null,
                                finish_reason: null
                            }],
                        })
                    );
                }
            });

            // 鐩戝惉瀹屾垚浜嬩欢
            completion.on("completion", (id, text) => {
                if (isStreamRequest) {
                    // 鍙戦€佹秷鎭閲?
                    res.write(
                        createEvent("data", {
                            choices: [
                                {
                                    content_filter_results: {
                                        hate: {filtered: false, severity: "safe"},
                                        self_harm: {filtered: false, severity: "safe"},
                                        sexual: {filtered: false, severity: "safe"},
                                        violence: {filtered: false, severity: "safe"},
                                    },
                                    delta: {content: text},
                                    finish_reason: null,
                                    index: 0,
                                },
                            ],
                            created: Math.floor(new Date().getTime() / 1000),
                            id: id,
                            model: jsonBody.model,
                            object: "chat.completion.chunk",
                            system_fingerprint: "114514",
                        })
                    );
                } else {
                    // 鍙彂閫佷竴娆★紝鍙戦€佹渶缁堝搷搴?
                    res.write(
                        JSON.stringify({
                            id: id,
                            object: "chat.completion",
                            created: Math.floor(new Date().getTime() / 1000),
                            model: jsonBody.model,
                            system_fingerprint: "114514",
                            choices: [
                                {
                                    index: 0,
                                    message: {
                                        role: "assistant",
                                        content: text,
                                    },
                                    logprobs: null,
                                    finish_reason: "stop",
                                },
                            ],
                            usage: {
                                prompt_tokens: 1,
                                completion_tokens: 1,
                                total_tokens: 1,
                            },
                        })
                    );
                    res.end();
                    stopSseKeepAlive();
                    releaseSession();
                }
            });

            // 鐩戝惉缁撴潫浜嬩欢
            completion.on("end", () => {
                if (isStreamRequest) {
                    res.write(createEvent("data", "[DONE]"));
                    res.end();
                }
                stopSseKeepAlive();
                releaseSession();
            });

            // 鐩戝惉閿欒浜嬩欢
            completion.on("error", (err) => {
                console.error("Completion error:", err);
                const errorMessage = "Error occurred: " + (err.message || "Unknown error");
                stopSseKeepAlive();
                if (!res.headersSent) {
                    if (isStreamRequest) {
                        res.write(
                            createEvent("data", {
                                choices: [
                                    {
                                        content_filter_results: {
                                            hate: {filtered: false, severity: "safe"},
                                            self_harm: {filtered: false, severity: "safe"},
                                            sexual: {filtered: false, severity: "safe"},
                                            violence: {filtered: false, severity: "safe"},
                                        },
                                        delta: {content: errorMessage},
                                        finish_reason: null,
                                        index: 0,
                                    },
                                ],
                                created: Math.floor(new Date().getTime() / 1000),
                                id: uuidv4(),
                                model: jsonBody.model,
                                object: "chat.completion.chunk",
                                system_fingerprint: "114514",
                            })
                        );
                        res.write(createEvent("data", "[DONE]"));
                        res.end();
                    } else {
                        res.write(
                            JSON.stringify({
                                id: uuidv4(),
                                object: "chat.completion",
                                created: Math.floor(new Date().getTime() / 1000),
                                model: jsonBody.model,
                                system_fingerprint: "114514",
                                choices: [
                                    {
                                        index: 0,
                                        message: {
                                            role: "assistant",
                                            content: errorMessage,
                                        },
                                        logprobs: null,
                                        finish_reason: "stop",
                                    },
                                ],
                                usage: {
                                    prompt_tokens: 1,
                                    completion_tokens: 1,
                                    total_tokens: 1,
                                },
                            })
                        );
                        res.end();
                    }
                }
                releaseSession();
            });

        } catch (error) {
            console.error("Request error:", error);
            stopSseKeepAlive();
            releaseSession();

            const errorMessage = "Error occurred, please check the log.\n\n<pre>" + (error.stack || error) + "</pre>";
            if (!res.headersSent) {
                if (isStreamRequest) {
                    res.write(
                        createEvent("data", {
                            choices: [
                                {
                                    content_filter_results: {
                                        hate: {filtered: false, severity: "safe"},
                                        self_harm: {filtered: false, severity: "safe"},
                                        sexual: {filtered: false, severity: "safe"},
                                        violence: {filtered: false, severity: "safe"},
                                    },
                                    delta: {content: errorMessage},
                                    finish_reason: null,
                                    index: 0,
                                },
                            ],
                            created: Math.floor(new Date().getTime() / 1000),
                            id: uuidv4(),
                            model: jsonBody.model,
                            object: "chat.completion.chunk",
                            system_fingerprint: "114514",
                        })
                    );
                    res.write(createEvent("data", "[DONE]"));
                    res.end();
                } else {
                    res.write(
                        JSON.stringify({
                            id: uuidv4(),
                            object: "chat.completion",
                            created: Math.floor(new Date().getTime() / 1000),
                            model: jsonBody.model,
                            system_fingerprint: "114514",
                            choices: [
                                {
                                    index: 0,
                                    message: {
                                        role: "assistant",
                                        content: errorMessage,
                                    },
                                    logprobs: null,
                                    finish_reason: "stop",
                                },
                            ],
                            usage: {
                                prompt_tokens: 1,
                                completion_tokens: 1,
                                total_tokens: 1,
                            },
                        })
                    );
                    res.end();
                }
            }
        }
    });
});

// Helper function: Normalize messages
async function openaiNormalizeMessages(messages) {
    let normalizedMessages = [];
    let currentSystemMessage = "";

    for (let message of messages) {
        if (message.role === 'system') {
            if (currentSystemMessage) {
                currentSystemMessage += "\n" + message.content;
            } else {
                currentSystemMessage = message.content;
            }
        } else {
            if (currentSystemMessage) {
                normalizedMessages.push({role: 'system', content: currentSystemMessage});
                currentSystemMessage = "";
            }

            // 妫€鏌ユ秷鎭唴瀹?
            if (Array.isArray(message.content)) {
                const textContent = message.content
                    .filter(item => item.type === 'text')
                    .map(item => item.text)
                    .join('\n');

                // 澶勭悊鍥剧墖鍐呭锛屽瓨鍌ㄥ浘鐗?
                for (const item of message.content) {
                    if (item.type === 'image_url' && item.image_url?.url) {
                        // 鑾峰彇濯掍綋绫诲瀷
                        const mediaType = await getMediaTypeFromUrl(item.image_url.url);
                        // 鑾峰彇鍥剧墖 base64
                        const base64Data = await fetchImageAsBase64(item.image_url.url);
                        if (base64Data) {
                            const {imageId} = storeImage(base64Data, mediaType);
                            console.log(`Image stored with ID: ${imageId}, Media Type: ${mediaType}`);
                        } else {
                            console.warn('Failed to store image due to missing data.');
                        }
                    }
                }

                normalizedMessages.push({role: message.role, content: textContent});
            } else if (typeof message.content === 'string') {
                normalizedMessages.push(message);
            } else {
            console.warn('Unknown message content format:', message.content);
                normalizedMessages.push(message);
            }
        }
    }

    if (currentSystemMessage) {
        normalizedMessages.push({role: 'system', content: currentSystemMessage});
    }

    return normalizedMessages;
}

// 鍥剧墖 URL 鑾峰彇濯掍綋绫诲瀷
async function getMediaTypeFromUrl(url) {
    try {
        const response = await fetch(url, {method: 'HEAD'});
        const contentType = response.headers.get('content-type');
        return contentType || guessMediaTypeFromUrl(url);
    } catch (error) {
        console.warn('Failed to fetch media type, fallback to URL guess', error);
        return guessMediaTypeFromUrl(url);
    }
}

function guessMediaTypeFromUrl(url) {
    const ext = path.extname(url).toLowerCase();
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
}

// 鍥剧墖 URL 鑾峰彇 base64
async function fetchImageAsBase64(url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return buffer.toString('base64');
    } catch (error) {
        console.error('Failed to fetch image data:', error);
        return null;
    }
}


// handle anthropic format model request
app.post("/v1/messages", AnthropicApiKeyAuth, (req, res) => {
    req.rawBody = "";
    req.setEncoding("utf8");
    clientState.setClosed(false);

    req.on("data", function (chunk) {
        req.rawBody += chunk;
    });

    req.on("end", async () => {
        console.log("Handling Anthropic-format request.");
        res.setHeader("Content-Type", "text/event-stream;charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        let jsonBody;

        try {
            jsonBody = JSON.parse(req.rawBody);
        } catch (error) {
            res.status(400).json({error: {code: 400, message: "Invalid JSON"}});
            return;
        }
        const isStreamRequest = Boolean(jsonBody.stream);
        let stopSseKeepAlive = () => {
        };

        // 澶勭悊娑堟伅鏍煎紡
        jsonBody.messages = anthropicNormalizeMessages(jsonBody.messages);

        if (jsonBody.system) {
            // 鎶婄郴缁熸秷鎭姞鍏?messages 鐨勯鏉?
            jsonBody.messages.unshift({role: "system", content: jsonBody.system});
        }
        console.log("message length:" + jsonBody.messages.length);

        // decide which model to use
        let proxyModel;
        if (process.env.AI_MODEL) {
            proxyModel = resolveModelId(process.env.AI_MODEL);
        } else if (jsonBody.model) {
            proxyModel = resolveModelId(jsonBody.model);
        } else {
            proxyModel = "claude_4_6_opus";
        }
        console.log(`Using model ${proxyModel}`);

        if (proxyModel && !availableModels.includes(proxyModel)) {
            res.json({error: {code: 404, message: "Invalid Model"}});
            return;
        }

        let selectedSession;
        let releaseSessionCalled = false;
        let completion;
        let cancel;
        let selectedBrowserId;
        // 瀹氫箟閲婃斁浼氳瘽
        const releaseSession = () => {
            if (selectedSession && selectedBrowserId && !releaseSessionCalled) {
                sessionManager.releaseSession(selectedSession, selectedBrowserId);
                console.log(`Released session ${selectedSession} and browser instance ${selectedBrowserId}`);
                releaseSessionCalled = true;
            }
        };

        // 鐩戝惉瀹㈡埛绔叧闂簨浠?
        res.on("close", () => {
            console.log(" > [Client closed]");
            clientState.setClosed(true);
            stopSseKeepAlive();
            if (completion) {
                completion.removeAllListeners();
            }
            if (cancel) {
                cancel();
            }
            releaseSession();
        });

        try {
            if (isStreamRequest) {
                stopSseKeepAlive = startSseKeepAlive(res);
            }
            // 鑾峰彇瀹㈡埛绔?IP
            const clientIpAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
            const geo = geoip.lookup(clientIpAddress) || {};
            const locationInfo = `${geo.country || 'Unknown'}-${geo.region || 'Unknown'}-${geo.city || 'Unknown'}`;
            const requestTime = new Date();

            // 鑾峰彇骞堕攣瀹氬彲鐢ㄤ細璇濆拰娴忚鍣ㄥ疄渚?
            const {
                selectedUsername,
                modeSwitched,
                browserInstance
            } = await sessionManager.getSessionByStrategy('round_robin');
            selectedSession = selectedUsername;
            selectedBrowserId = browserInstance.id;
            console.log("Using session " + selectedSession);

            // 璁板綍璇锋眰淇℃伅
            await requestLogger.logRequest({
                time: requestTime,
                ip: clientIpAddress,
                location: locationInfo,
                model: jsonBody.model,
                session: selectedSession
            });

            ({completion, cancel} = await provider.getCompletion({
                username: selectedSession,
                messages: jsonBody.messages,
                browserInstance: browserInstance,
                stream: isStreamRequest,
                proxyModel: proxyModel,
                useCustomMode: process.env.USE_CUSTOM_MODE === "true",
                modeSwitched: modeSwitched // 浼犻€掓ā寮忓垏鎹㈡爣蹇?
            }));

            // 鐩戝惉寮€濮嬩簨浠?
            completion.on("start", (id) => {
                if (isStreamRequest) {
                    // send message start
                    res.write(createEvent("message_start", {
                        type: "message_start",
                        message: {
                            id: `${id}`,
                            type: "message",
                            role: "assistant",
                            content: [],
                            model: proxyModel,
                            stop_reason: null,
                            stop_sequence: null,
                            usage: {input_tokens: 8, output_tokens: 1},
                        },
                    }));
                    res.write(createEvent("content_block_start", {
                        type: "content_block_start",
                        index: 0,
                        content_block: {type: "text", text: ""}
                    }));
                    res.write(createEvent("ping", {type: "ping"}));
                }
            });

            // 鐩戝惉瀹屾垚浜嬩欢
            completion.on("completion", (id, text) => {
                if (isStreamRequest) {
                    // send message delta
                    res.write(createEvent("content_block_delta", {
                        type: "content_block_delta",
                        index: 0,
                        delta: {type: "text_delta", text: text},
                    }));
                } else {
                    // 鍙細鍙戜竴娆★紝鍙戦€乫inal response
                    res.write(JSON.stringify({
                        id: id,
                        content: [
                            {text: text},
                            {id: "string", name: "string", input: {}},
                        ],
                        model: proxyModel,
                        stop_reason: "end_turn",
                        stop_sequence: null,
                        usage: {input_tokens: 0, output_tokens: 0},
                    }));
                    res.end();
                    stopSseKeepAlive();
                    releaseSession();
                }
            });

            // 鐩戝惉缁撴潫浜嬩欢
            completion.on("end", () => {
                if (isStreamRequest) {
                    res.write(createEvent("content_block_stop", {type: "content_block_stop", index: 0}));
                    res.write(createEvent("message_delta", {
                        type: "message_delta",
                        delta: {stop_reason: "end_turn", stop_sequence: null},
                        usage: {output_tokens: 12},
                    }));
                    res.write(createEvent("message_stop", {type: "message_stop"}));
                    res.end();
                }
                stopSseKeepAlive();
                releaseSession();
            });

            // 鐩戝惉閿欒浜嬩欢
            completion.on("error", (err) => {
                console.error("Completion error:", err);
                // 鍚戝鎴风杩斿洖閿欒淇℃伅
                const errorMessage = "Error occurred: " + (err.message || "Unknown error");
                stopSseKeepAlive();
                if (!res.headersSent) {
                    if (isStreamRequest) {
                        res.write(createEvent("content_block_delta", {
                            type: "content_block_delta",
                            index: 0,
                            delta: {type: "text_delta", text: errorMessage},
                        }));
                        res.end();
                    } else {
                        res.write(JSON.stringify({
                            id: uuidv4(),
                            content: [{text: errorMessage}, {id: "string", name: "string", input: {}}],
                            model: proxyModel,
                            stop_reason: "error",
                            stop_sequence: null,
                            usage: {input_tokens: 0, output_tokens: 0},
                        }));
                        res.end();
                    }
                }
                releaseSession();
            });

        } catch (error) {
            console.error("Request error:", error);
            stopSseKeepAlive();
            releaseSession();

            const errorMessage = "Error occurred, please check the log.\n\n<pre>" + (error.stack || error) + "</pre>";
            if (!res.headersSent) {
                if (isStreamRequest) {
                    res.write(createEvent("content_block_delta", {
                        type: "content_block_delta",
                        index: 0,
                        delta: {type: "text_delta", text: errorMessage},
                    }));
                    res.end();
                } else {
                    res.write(JSON.stringify({
                        id: uuidv4(),
                        content: [{text: errorMessage}, {id: "string", name: "string", input: {}}],
                        model: proxyModel,
                        stop_reason: "error",
                        stop_sequence: null,
                        usage: {input_tokens: 0, output_tokens: 0},
                    }));
                    res.end();
                }
            }
        }
    });
});

// 杈呭姪鍑芥暟锛氳鑼冨寲娑堟伅鏍煎紡
function anthropicNormalizeMessages(messages) {
    return messages.map(message => {
        if (typeof message.content === 'string') {
            return message;
        } else if (Array.isArray(message.content)) {
            // 鎻愬彇鏂囨湰鍐呭
            const textContent = message.content
                .filter(item => item.type === 'text')
                .map(item => item.text)
                .join('\n');

            // 澶勭悊鍥剧墖鍐呭锛屽瓨鍌ㄥ浘鐗?
            message.content.forEach(item => {
                if (item.type === 'image' && item.source?.type === 'base64') {
                    const {imageId, mediaType} = storeImage(item.source.data, item.source.media_type);
                    console.log(`Image stored with ID: ${imageId}, Media Type: ${mediaType}`);
                }
            });

            return {...message, content: textContent};
        } else {
            console.warn('Unknown message format:', message);
            return message; // 鏈煡鏍煎紡锛岃繑鍥炲師濮嬫秷鎭?
        }
    });
}


// handle other
app.use((req, res, next) => {
    const {revision, branch} = getGitRevision();
    res.status(404).send("Not Found (YouChat_Proxy " + revision + "@" + branch + ")");
    console.log("Received request on invalid endpoint. Please check your API path.")
});


app.listen(port, async () => {
    // 杈撳嚭褰撳墠鏈堜唤鐨勮姹傜粺璁′俊鎭?
    provider.getLogger().printStatistics();
    console.log(`YouChat proxy listening on port ${port}`);
    if (!validApiKey) {
        console.log(`Proxy is currently running with no authentication`);
    }
    console.log(`Custom mode: ${process.env.USE_CUSTOM_MODE === "true" ? "enabled" : "disabled"}`);
    console.log(`Mode rotation: ${process.env.ENABLE_MODE_ROTATION === "true" ? "enabled" : "disabled"}`);
});

function AnthropicApiKeyAuth(req, res, next) {
    const reqApiKey = req.header("x-api-key");

    if (validApiKey && reqApiKey !== validApiKey) {
        // If Environment variable PASSWORD is set AND x-api-key header is not equal to it, return 401
        const clientIpAddress = req.headers["x-forwarded-for"] || req.ip;
        console.log(`Receviced Request from IP ${clientIpAddress} but got invalid password.`);
        return res.status(401).json({error: "Invalid Password"});
    }

    next();
}

function OpenAIApiKeyAuth(req, res, next) {
    const reqApiKey = req.header("Authorization");

    if (validApiKey && reqApiKey !== "Bearer " + validApiKey) {
        // If Environment variable PASSWORD is set AND Authorization header is not equal to it, return 401
        const clientIpAddress = req.headers["x-forwarded-for"] || req.ip;
        console.log(`Receviced Request from IP ${clientIpAddress} but got invalid password.`);
        return res.status(401).json({error: {code: 403, message: "Invalid Password"}});
    }

    next();
}

// Path: client-state
class ClientState {
    #closed = false;

    setClosed(value) {
        this.#closed = Boolean(value);
    }

    isClosed() {
        return this.#closed;
    }
}

export const clientState = new ClientState();




