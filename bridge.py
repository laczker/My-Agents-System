import os, subprocess, requests, time, json

env_path = "/home/agent/agent-system/.env"
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            if "=" in line and not line.startswith("#"):
                k, v = line.strip().split("=", 1)
                os.environ[k] = v.strip('"\'')

token = os.getenv("TELEGRAM_BOT_TOKEN")
chat_id = os.getenv("TELEGRAM_CHAT_ID")
base_url = f"https://api.telegram.org/bot{token}"

HISTORY_FILE = "/home/agent/agent-system/personal/assistant/chat_history.txt"
INBOX_DIR = "/home/agent/agent-system/personal/assistant/inbox"
SESSION_FILE = "/home/agent/agent-system/personal/assistant/session_id.txt"

def send_msg(text):
    for chunk in [text[i:i+4000] for i in range(0, len(text), 4000)]:
        requests.post(f"{base_url}/sendMessage", json={"chat_id": chat_id, "text": chunk}, timeout=10)

def download_file(file_id, file_name):
    try:
        res = requests.get(f"{base_url}/getFile", params={"file_id": file_id}).json()
        file_path = res.get("result", {}).get("file_path")
        if file_path:
            download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
            r = requests.get(download_url)
            save_path = os.path.join(INBOX_DIR, file_name)
            with open(save_path, "wb") as f:
                f.write(r.content)
            return save_path, None
        error_desc = res.get("description", "neznámá chyba (Telegram nevrátil file_path)")
        print(f"Chyba při stahování souboru '{file_name}': {error_desc}", flush=True)
        return None, error_desc
    except Exception as e:
        print(f"Chyba při stahování souboru '{file_name}': {e}", flush=True)
        return None, str(e)

HISTORY_EXCHANGES = 10  # posledních N výměn (Uživatel/Claude), ne posledních N řádků

def get_history():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f:
            content = f.read()
        exchanges = [e for e in content.split("---\n") if e.strip()]
        return "---\n".join(exchanges[-HISTORY_EXCHANGES:])
    return ""

def append_history(user_msg, bot_msg):
    with open(HISTORY_FILE, "a") as f:
        f.write(f"Uživatel: {user_msg}\n")
        f.write(f"Claude: {bot_msg}\n---\n")

def get_session_id():
    if os.path.exists(SESSION_FILE):
        return open(SESSION_FILE).read().strip() or None
    return None

def save_session_id(session_id):
    with open(SESSION_FILE, "w") as f:
        f.write(session_id)

CLAUDE_CWD = "/home/agent/agent-system/personal/assistant"
STDERR_LOG = "/home/agent/agent-system/bridge_claude_stderr.log"

claude_proc = None  # trvale běžící `claude` proces (stream-json), místo nového procesu na zprávu

def start_claude_process(resume_session_id=None):
    global claude_proc
    cmd = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json",
           "--verbose", "--dangerously-skip-permissions", "--autocompact", "auto"]
    if resume_session_id:
        cmd += ["--resume", resume_session_id]
    stderr_f = open(STDERR_LOG, "a")
    claude_proc = subprocess.Popen(
        cmd, cwd=CLAUDE_CWD,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr_f,
        text=True, bufsize=1
    )
    return claude_proc

def send_to_claude_process(prompt_text, timeout=280):
    """Pošle jednu zprávu do běžícího persistentního `claude` procesu (stream-json
    stdin/stdout) a čeká na řádek {"type": "result"}, který značí konec tahu.
    Vyhodí výjimku, pokud proces mezitím spadne nebo neodpoví včas."""
    msg = json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": prompt_text}]}})
    claude_proc.stdin.write(msg + "\n")
    claude_proc.stdin.flush()

    deadline = time.time() + timeout
    while time.time() < deadline:
        line = claude_proc.stdout.readline()
        if not line:
            raise RuntimeError("claude proces skončil (EOF na stdout)")
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("session_id"):
            save_session_id(obj["session_id"])
        if obj.get("type") == "result":
            return obj.get("result") or "Úkol dokončen.", obj.get("is_error", False)
    raise TimeoutError("claude proces neodpověděl včas")

def run_claude(user_text, downloaded_file_info):
    """Posílá zprávy do jednoho trvale běžícího `claude` procesu (stream-json) místo
    spouštění nového procesu na každou zprávu — šetří cold-start čas startu binárky.
    Kontext drží nativně sám běžící proces (žádné --resume potřeba za normálního
    provozu). Pokud proces spadne/neodpoví, restartuje se s --resume podle
    session_id.txt; pokud selže i to, spadne zpět na čistě novou session s textovou
    historií jako jednorázový fallback (stejný mechanismus jako dřív)."""
    global claude_proc
    prompt = f"{downloaded_file_info}{user_text}"

    if claude_proc is None or claude_proc.poll() is not None:
        start_claude_process(resume_session_id=get_session_id())

    try:
        result, is_error = send_to_claude_process(prompt)
        if not is_error:
            return result
    except Exception as e:
        print(f"Chyba komunikace s claude procesem: {e}", flush=True)

    # Proces spadl / neodpověděl / vrátil chybu -> tvrdý restart a jedna zkouška
    # znovu, tentokrát s textovou historií jako plnou náhradou kontextu.
    try:
        if claude_proc:
            claude_proc.kill()
    except Exception:
        pass
    start_claude_process(resume_session_id=None)
    history_context = get_history()
    fallback_prompt = (
        f"HISTORIE KONVERZACE:\n{history_context}\n"
        f"{downloaded_file_info}"
        f"AKTUÁLNÍ ZPRÁVA OD UŽIVATELE: {user_text}\n\n"
        f"Odpověz věcně. Pokud uživatel přiložil soubor, zkontroluj jeho obsah v inboxu."
    )
    try:
        result, _ = send_to_claude_process(fallback_prompt)
        return result
    except Exception as e:
        print(f"Chyba i po restartu claude procesu: {e}", flush=True)
        return f"⚠️ Nepodařilo se spojit s Claude procesem: {e}"

offset = 0
try:
    init_res = requests.get(f"{base_url}/getUpdates", timeout=5).json()
    results = init_res.get("result", [])
    if results:
        offset = results[-1]["update_id"] + 1
except Exception:
    pass

start_claude_process(resume_session_id=get_session_id())

send_msg("🚀 AI Centrální Správce je aktivní (s pamětí a podporou souborů)!")

while True:
    try:
        res = requests.get(f"{base_url}/getUpdates", params={"offset": offset, "timeout": 15}, timeout=20).json()
        for update in res.get("result", []):
            offset = update["update_id"] + 1
            msg = update.get("message", {})
            if str(msg.get("chat", {}).get("id")) == str(chat_id):
                user_text = msg.get("text", "") or msg.get("caption", "")
                downloaded_file_info = ""
                
                # Zpracování přiložených souborů / dokumentů
                if "document" in msg:
                    doc = msg["document"]
                    file_name = doc.get("file_name", "uploaded_file")
                    saved_path, download_error = download_file(doc["file_id"], file_name)
                    if saved_path:
                        downloaded_file_info = f"\n[PŘIPOJEN SOUBOR: {saved_path}]\n"
                    else:
                        send_msg(f"⚠️ Nepodařilo se stáhnout přílohu '{file_name}': {download_error}")
                elif "photo" in msg:
                    photo = msg["photo"][-1]  # poslední = největší rozlišení
                    file_name = f"{photo['file_unique_id']}.jpg"
                    saved_path, download_error = download_file(photo["file_id"], file_name)
                    if saved_path:
                        downloaded_file_info = f"\n[PŘIPOJEN SOUBOR: {saved_path}]\n"
                    else:
                        send_msg(f"⚠️ Nepodařilo se stáhnout přílohu '{file_name}': {download_error}")
                
                if not user_text and not downloaded_file_info:
                    continue

                send_msg("⏳ Zpracovávám...")

                output = run_claude(user_text, downloaded_file_info)

                # Uložení do historie (čitelný log + fallback, kdyby --resume selhal)
                append_history(user_text + downloaded_file_info, output)
                
                send_msg(f"✅ Výsledek:\n{output}")
    except Exception as e:
        print(f"Chyba v hlavní smyčce: {e}", flush=True)
        time.sleep(5)
