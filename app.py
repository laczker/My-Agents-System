import os, time, requests

token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")

url = f"https://api.telegram.org/bot{token}/sendMessage"
requests.post(url, json={"chat_id": chat_id, "text": "🚀 Ahoj z Hetzner Dockeru! Tvoj agent je online."})

offset = 0
while True:
    try:
        res = requests.get(f"https://api.telegram.org/bot{token}/getUpdates", params={"offset": offset, "timeout": 20}).json()
        for update in res.get("result", []):
            offset = update["update_id"] + 1
            msg = update.get("message", {})
            if str(msg.get("chat", {}).get("id")) == str(chat_id):
                text = msg.get("text", "")
                requests.post(url, json={"chat_id": chat_id, "text": f"Příkaz přijat: {text}"})
    except Exception:
        time.sleep(5)
