-- language: lua, file: fr_limiter.lua, target: openresty/nginx (OpenResty 1.25+)
-- prae-phase limit-check + client-auth, post-phase usage-zaehlung (JSON und SSE)
-- secrets werden vom entrypoint per sed eingebettet (__CLIENT_API_KEY__ usw.)
local cjson = require "cjson.safe"
local lock = require "resty.lock"

local _M = {}

local COUNTER_FILE = "/var/lib/fr-gateway-counter/counter.json"
local DAILY_LIMIT = tonumber("__DAILY_TOKEN_LIMIT__") or 2000000
local RESET_TZ = os.getenv("RESET_TZ") or "UTC"
local CLIENT_API_KEY = "__CLIENT_API_KEY__"

local function now_iso()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function today_utc()
    return os.date("!%Y-%m-%d")
end

local function next_reset_iso()
    local t = os.time()
    local y, m, d = os.date("!%Y", t), os.date("!%m", t), os.date("!%d", t)
    local midnight = os.time({ year = y, month = m, day = d, hour = 0, min = 0, sec = 0 })
    return os.date("!%Y-%m-%dT%H:%M:%SZ", midnight + 86400)
end

local function read_counter()
    local f = io.open(COUNTER_FILE, "r")
    if not f then
        return { date = today_utc(), tokens = 0, updated_at = now_iso() }
    end
    local data = f:read("*a")
    f:close()
    local obj = cjson.decode(data)
    if type(obj) ~= "table" then
        return { date = today_utc(), tokens = 0, updated_at = now_iso() }
    end
    obj.date = obj.date or today_utc()
    obj.tokens = tonumber(obj.tokens) or 0
    return obj
end

local function write_counter(obj)
    obj.updated_at = now_iso()
    local tmp = COUNTER_FILE .. ".tmp." .. tostring(ngx.worker.pid())
    local f = io.open(tmp, "w")
    if not f then
        return false
    end
    local ok = f:write(cjson.encode(obj))
    f:close()
    if not ok then
        os.remove(tmp)
        return false
    end
    return os.rename(tmp, COUNTER_FILE)
end

local function with_lock(fn)
    local lk, lerr = lock:new("locks")
    if not lk then
        ngx.log(ngx.ERR, "lock init failed: ", tostring(lerr))
        return fn()
    end
    local elapsed, werr = lk:lock("counter")
    if not elapsed then
        ngx.log(ngx.ERR, "lock wait failed: ", tostring(werr))
        return fn()
    end
    local ok, res = pcall(fn)
    lk:unlock()
    if not ok then
        return nil, res
    end
    return res
end

local function add_usage(add)
    if not add or add <= 0 then
        return
    end
    with_lock(function()
        local c = read_counter()
        if c.date ~= today_utc() then
            c.date = today_utc()
            c.tokens = 0
        end
        c.tokens = c.tokens + add
        write_counter(c)
    end)
end

local function extract_json(body)
    local obj = cjson.decode(body)
    if type(obj) == "table" then
        return obj
    end
    local s = body:find("{")
    if s then
        local e = body:find("}", s, true)
        local last = e
        while e do
            last = e
            e = body:find("}", e + 1, true)
        end
        if last then
            local o = cjson.decode(body:sub(s, last))
            if type(o) == "table" then
                return o
            end
        end
    end
    return nil
end

local function count_usage(body)
    local obj = extract_json(body)
    if not obj or type(obj.usage) ~= "table" then
        return false
    end
    local u = obj.usage
    local add = (tonumber(u.prompt_tokens) or 0) + (tonumber(u.completion_tokens) or 0)
    add_usage(add)
    return true
end

function _M.access()
    if CLIENT_API_KEY ~= "" then
        local hdr = ngx.var.http_authorization or ""
        if hdr ~= "Bearer " .. CLIENT_API_KEY then
            ngx.status = ngx.HTTP_UNAUTHORIZED
            ngx.header.content_type = "application/json"
            ngx.say(cjson.encode({ error = { message = "unauthorized", type = "invalid_request_error" } }))
            return ngx.exit(ngx.HTTP_UNAUTHORIZED)
        end
    end

    local verdict, err = with_lock(function()
        local c = read_counter()
        if c.date ~= today_utc() then
            c.date = today_utc()
            c.tokens = 0
        end
        if c.tokens >= DAILY_LIMIT then
            return { blocked = true, reset = next_reset_iso() }
        end
        return { blocked = false }
    end)

    if not verdict then
        ngx.log(ngx.ERR, "counter read failed: ", tostring(err))
    elseif verdict.blocked then
        ngx.status = ngx.HTTP_TOO_MANY_REQUESTS
        ngx.header.content_type = "application/json"
        ngx.header.retry_after = "60"
        ngx.say(cjson.encode({
            error = { message = "daily token limit reached", reset_at_utc = verdict.reset }
        }))
        return ngx.exit(ngx.HTTP_TOO_MANY_REQUESTS)
    end
end

function _M.post_body()
    if ngx.status ~= 200 then
        return
    end
    local ct = ngx.header.content_type or ""
    local ctx = ngx.ctx

    if ct:find("application/json", 1, true) or ct:find("text/event-stream", 1, true) then
        if not ctx.collecting then
            ctx.collecting = true
            ctx.chunks = {}
        end
        if ngx.arg[1] then
            ctx.chunks[#ctx.chunks + 1] = ngx.arg[1]
        end
        if ngx.arg[2] then
            ctx.collecting = false
            local body = table.concat(ctx.chunks)
            ctx.chunks = nil
            if not ctx.sse_counted then
                if count_usage(body) then
                    ctx.sse_counted = true
                elseif ct:find("text/event-stream", 1, true) then
                    for line in body:gmatch("data: ([^\n]+)") do
                        local obj = cjson.decode(line)
                        if type(obj) == "table" and type(obj.usage) == "table" then
                            if count_usage(cjson.encode(obj)) then
                                ctx.sse_counted = true
                                break
                            end
                        end
                    end
                end
            end
        end
    end
end

return _M
