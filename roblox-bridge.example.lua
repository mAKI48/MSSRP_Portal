-- MSSRP Roblox bridge example
-- ServerScriptService only. Do NOT put secrets in LocalScripts.

local HttpService = game:GetService("HttpService")

local BRIDGE_URL = "https://YOUR-BACKEND.example.com/roblox/events"
local BRIDGE_SECRET = "SET_THIS_ON_THE_SERVER"

local function sendMSSRPEvent(eventType, payload)
    local body = HttpService:JSONEncode({
        event_type = eventType,
        payload = payload or {}
    })

    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = BRIDGE_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Authorization"] = "Bearer " .. BRIDGE_SECRET
            },
            Body = body
        })
    end)

    if not ok then
        warn("MSSRP bridge request failed", response)
        return false
    end

    if not response.Success then
        warn("MSSRP bridge returned", response.StatusCode, response.Body)
        return false
    end

    return true
end

-- Example:
-- sendMSSRPEvent("player_joined", {
--     user_id = player.UserId,
--     username = player.Name
-- })

return {
    SendEvent = sendMSSRPEvent
}
