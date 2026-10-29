# API-server (Brightspace AI Helper)

Doorstuurserver tussen de extensie en de AI-provider: inloggen (e-mailcode), limieten, kostenboekhouding en de AI-aanroep.

- Node 22, TypeScript, Fastify 5, SQLite (`better-sqlite3`), Better Auth (e-mailcode + bearer-token), zod.
- Geen vragen, context of antwoorden worden opgeslagen of gelogd. Alleen tellers (tokens, kosten) in `usage_events`.

## Lokaal draaien (zonder echte AI en zonder e-mail)

```bash
cd server
npm install
npm test                 # 39 tests
npm run dev              # PROVIDER=fake: nep-AI; aanmeldcodes verschijnen in de console
# Echte AI lokaal: PROVIDER=gemini PROVIDER_API_KEY=... npm run dev
# Dan in de hoofdmap: npm run build:local
```

Standaard (`NODE_ENV` niet `production`) gebruikt de server `PROVIDER=fake` en print aanmeldcodes als `[dev mail] sign-up code for …`.

Snelle handmatige test:

```bash
# eenmalig aanmelden: aanmeldcode per mail, dan code + gekozen wachtwoord
curl -s -X POST localhost:3000/v1/auth/signup/start -H 'content-type: application/json' \
  -d '{"email":"jij@example.nl"}'
# code uit de serverlog, dan:
curl -s -X POST localhost:3000/v1/auth/signup -H 'content-type: application/json' \
  -d '{"email":"jij@example.nl","code":"123456","password":"minstens-8-tekens"}'   # → {"token": "...", "user": {...}}
# wachtwoord vergeten: resetcode per mail (alleen als het adres een account heeft), dan code + nieuw wachtwoord
#   POST /v1/auth/reset/start {"email"}  en  POST /v1/auth/reset {"email","code","password"}
# daarna altijd inloggen met e-mail + wachtwoord:
curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"jij@example.nl","password":"minstens-8-tekens"}'
curl -s -X POST localhost:3000/v1/generate -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"kind":"chat","question":"Wat is de deadline?","context_markdown":"Deadline: 1 december","client":{"version":"1.0.0"}}'
```

## Beheer (op de server)

```bash
docker compose exec api node server/dist/server/src/cli.js email:allow student@example.nl      # goedkeuren: krijgt USER_DAILY_EUR per dag (geen week- of maandlimiet)
docker compose exec api node server/dist/server/src/cli.js email:revoke student@example.nl     # toegang weer weg
docker compose exec api node server/dist/server/src/cli.js email:list
docker compose exec api node server/dist/server/src/cli.js host:block universiteitleiden.nl --reason "verzoek van de instelling"
docker compose exec api node server/dist/server/src/cli.js host:unblock universiteitleiden.nl
docker compose exec api node server/dist/server/src/cli.js usage:today      # kosten per gebruiker + totaal
docker compose exec api node server/dist/server/src/cli.js user:list
docker compose exec -it api node server/dist/server/src/cli.js user:create --email jij@example.nl   # vraagt om een wachtwoord (wachtwoordlogin)
docker compose exec -it api node server/dist/server/src/cli.js user:set-password --email jij@example.nl
```

`host:block <domein>` blokkeert dat domein en alle subdomeinen, zowel als e-maildomein (`@student.hhs.nl`) als als Brightspace-host die de extensie meestuurt (`hhs.brightspace.com`). De extensie meldt die host zelf, dus dit is een beleidsmaatregel voor eerlijke gebruikers, geen harde beveiliging.

## Uitrollen op de Strato-VPS

### Wat ik van jou nodig heb

1. **De VPS besteld** (VPS S, locatie Duitsland of Frankrijk, Ubuntu 24.04 LTS) en het **IP-adres** + het root-wachtwoord of de eerste login uit de Strato-mail.
2. Een **hostnaam** die naar dat IP wijst (zie "Gratis hostnaam" hieronder).
3. Een **Google AI Studio / Google Cloud-project met facturering** en een API-sleutel (de gratis laag mag niet voor EU-gebruikers).
4. Een **SMTP-account** voor aanmeldcodes (zie "E-mail").
5. Als iets niet lukt: plak de foutmelding in de chat. Je kunt commando's in deze sessie draaien met `! <commando>`.

### Gratis hostnaam

Een eigen domein is niet nodig om te starten. Opties:

- **DuckDNS** (duckdns.org, gratis): maak een subdomein `jouwnaam.duckdns.org` en zet het IP van je VPS erbij. Caddy haalt dan zelf een geldig HTTPS-certificaat via poort 80/443. Dit werkt voor de bèta.
- Kijk in het Strato-klantpaneel of je VPS een eigen hostnaam heeft (staat soms bij de serverinformatie). Dat kan ook, maar controleer of daar een certificaat voor uitgegeven mag worden.
- **Let op:** de extensie vraagt toestemming voor precies dit domein (`host_permissions`). Verhuizen naar een ander domein betekent een extensie-update waarbij Chrome opnieuw om toestemming vraagt. Een eigen domein (ca. €10 per jaar) voordat je echte testers uitnodigt voorkomt dat.

### DuckDNS bijwerken (optioneel)

Het IP van een VPS verandert normaal niet. Wil je het toch automatisch laten bijwerken: `*/10 * * * * curl -s "https://www.duckdns.org/update?domains=bshelper&token=<TOKEN>&ip=<SERVER_IPV4>&ipv6=<SERVER_IPV6>" >/dev/null`.

### E-mail voor aanmeldcodes

Elke SMTP-dienst werkt (`SMTP_URL=smtp://gebruiker:wachtwoord@host:587`). Zonder eigen domein is de afzender een gratis adres van de dienst; mail kan dan in de spam belanden. Voor de bèta met bekende mensen is dat acceptabel; met een eigen domein stel je SPF/DKIM in.

### Stappen op de server

```bash
# 1. Als root: bijwerken, gebruiker aanmaken
apt update && apt upgrade -y
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ 2>/dev/null || true
chown -R deploy:deploy /home/deploy/.ssh

# 2. Vanaf je eigen computer: sleutel plaatsen en testen dat inloggen als deploy werkt
ssh-copy-id deploy@<IP>          # daarna: ssh deploy@<IP>

# 3. Als deploy: SSH met alleen sleutels, firewall, automatische updates, swap
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/; s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
sudo apt install -y ufw fail2ban unattended-upgrades sqlite3 age
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. Docker (Strato: "Docker ready") 
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker deploy   # daarna opnieuw inloggen

# 5. Zet in het Strato-klantpaneel de firewall op: 22 (liefst alleen jouw IP), 80, 443
```

Controleer **vóór** stap 3 dat je als `deploy` met je sleutel kunt inloggen, anders sluit je jezelf buiten (de VNC-console en het rescue-systeem van Strato zijn je vangnet).

### Eerste uitrol

```bash
# Op je computer (docker nodig):
./server/deploy/deploy.sh deploy@<IP>
# Eerste keer stopt het script bij "Missing ~/app/.env": dat is de bedoeling. Het heeft de bestanden al gekopieerd.

# Op de server:
cd ~/app && cp .env.example .env && chmod 600 .env && nano .env     # vul in

# Opnieuw op je computer:
./server/deploy/deploy.sh deploy@<IP>
curl https://<jouw-hostnaam>/healthz        # → {"ok":true,...}
```

De Docker-bestanden zijn nog niet op een echte server geprobeerd (er is geen Docker op de ontwikkelmachine). Verwacht dat de eerste uitrol één of twee kleine aanpassingen nodig heeft.

### Back-up (dagelijks, versleuteld)

```bash
age-keygen -o ~/backup-key.txt        # bewaar dit bestand OFFLINE (niet alleen op de server!)
# publieke sleutel staat in het bestand na "# public key:"
crontab -e
# 15 3 * * * AGE_RECIPIENT=age1... OFFSITE_CMD="rclone copy {} remote:backups" /home/deploy/app/backup.sh >> /home/deploy/backup.log 2>&1
```

Strato maakt zelf geen back-ups. Zonder kopie op een andere plek (`OFFSITE_CMD`) ben je bij een serverstoring alles kwijt. Test een herstel (`age -d` en `sqlite3`) voordat je gebruikers uitnodigt.

### Controle na de uitrol

- `https://<hostnaam>/healthz` geeft `ok: true` en het juiste model.
- `docker compose logs -f api` toont geen fouten en geen tokens/e-mailadressen met vragen.
- Eén testaanmelding met een uitnodigingscode werkt end-to-end.
- `usage:today` toont na een vraag de kosten.
- Zet in Google Cloud een **budgetmelding** en een **kwotum** voor de Gemini API (de noodrem in de server is een tweede vangnet, geen vervanging).

## Configuratie

Alles via omgevingsvariabelen, zie `deploy/.env.example`. In productie weigert de server te starten zonder `AUTH_SECRET` (≥ 32 tekens), API-sleutel, SMTP en een `https://` `PUBLIC_URL`, en met `PROVIDER=fake`. Een model zonder bekende prijs weigert ook te starten (zet dan `PRICE_IN_USD_PER_M` en `PRICE_OUT_USD_PER_M`), omdat de kostenlimieten anders niets betekenen.

Prijzen in `src/pricing.ts` zijn van 2026-10-21; controleer ze bij de lancering.
