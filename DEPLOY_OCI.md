# OCI 서버 배포 및 도메인 연결 가이드 (hand.dldcom.xyz)

본 가이드는 오라클 클라우드(OCI) 리눅스 서버(Ubuntu 권장)에 수어 인식 페이지(React)와 AI 자동 훈련 봇(Python)을 함께 배포하고, 사용자 도메인(`hand.dldcom.xyz`)을 HTTPS로 연결하는 전체 과정을 담고 있습니다.

> ⚠️ **중요 (HTTPS 필수)**: 웹 브라우저에서 사용자 카메라(`getUserMedia`)에 접근하려면 반드시 HTTPS(보안 연결)가 필요합니다. 따라서 Certbot을 이용한 무료 SSL 인증서 발급 과정이 포함되어 있습니다.

---

## 1. 도메인 DNS 설정 (서버 접속 전)

도메인을 구입하신 호스팅 업체(가비아, 카페24, 호스팅케이알 등)의 DNS 관리 페이지에서 아래 레코드를 추가합니다.

- **타입 (Type)**: `A`
- **이름 (Name/Host)**: `hand`
- **값 (Value/Target)**: `OCI 서버의 공인 IP 주소`
- **TTL**: 기본값 유지

---

## 2. 서버 필수 패키지 설치

OCI 서버에 SSH로 접속한 뒤, 프론트엔드 빌드(Node.js)와 백엔드 봇(Python), 그리고 웹 서버(Nginx)를 가동하기 위한 필수 프로그램들을 설치합니다.

```bash
# 패키지 목록 업데이트
sudo apt update

# Nginx, Python, 가상환경, Certbot 설치
sudo apt install -y nginx python3 python3-pip python3-venv certbot python3-certbot-nginx

# Node.js (버전 20) 및 npm 설치
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 3. 깃허브에서 프로젝트 클론 및 환경 변수 세팅

```bash
# 1. 깃허브에서 프로젝트 다운로드
cd ~
git clone https://github.com/본인아이디/hand.git
cd hand

# 2. 환경 변수 파일 생성 (.env)
nano .env
```
열린 편집기 창에 아래 내용을 작성합니다 (자신의 Supabase 정보 입력):
```env
VITE_SUPABASE_URL=https://[본인프로젝트주소].supabase.co
VITE_SUPABASE_ANON_KEY=[본인의_anon_public_key]
```
작성 후 `Ctrl+O`, `Enter`, `Ctrl+X`를 눌러 저장하고 나옵니다.

---

## 4. 프론트엔드 (React) 빌드

웹 페이지를 사용자에게 서비스하기 위해 최적화된 정적 파일(dist)로 빌드합니다.

```bash
# 프로젝트 최상단 디렉토리(~ /hand)에서 실행
npm install
npm run build
```
성공적으로 완료되면 `hand/dist` 폴더가 생성됩니다.

---

## 5. 웹 서버(Nginx) 설정 및 HTTPS 적용

방금 빌드한 웹 페이지를 `hand.dldcom.xyz` 도메인과 연결합니다.

```bash
# Nginx 설정 파일 생성
sudo nano /etc/nginx/sites-available/hand
```
아래 내용을 복사하여 붙여넣고 저장(`Ctrl+O` -> `Enter` -> `Ctrl+X`)합니다. (경로 주의: `/home/ubuntu/hand/dist` 부분은 본인의 리눅스 계정명에 맞게 수정하세요. 보통 `ubuntu` 또는 `opc` 입니다.)

```nginx
server {
    listen 80;
    server_name hand.dldcom.xyz;

    location / {
        root /home/ubuntu/hand/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
```

생성한 설정을 활성화하고 Nginx를 재시작합니다.
```bash
# 심볼릭 링크 생성 (활성화)
sudo ln -s /etc/nginx/sites-available/hand /etc/nginx/sites-enabled/

# Nginx 문법 검사 및 재시작
sudo nginx -t
sudo systemctl restart nginx
```

### 🔒 Let's Encrypt 무료 SSL (HTTPS) 발급
카메라 권한을 얻기 위해 HTTPS를 적용합니다. 아래 명령어를 치면 이메일 입력 등 몇 가지 질문이 나오며, 완료 시 자동으로 Nginx 설정에 HTTPS 코드가 삽입됩니다.
```bash
sudo certbot --nginx -d hand.dldcom.xyz
```

---

## 6. AI 훈련 봇 24시간 가동 (백그라운드)

마지막으로, 클라우드에서 새로운 수어 데이터를 실시간으로 감지하고 훈련시킬 파이썬 봇을 켭니다.

```bash
# 1. 봇 폴더로 이동
cd ~/hand/ai_bot

# 2. 파이썬 가상환경 생성 및 활성화
python3 -m venv .venv
source .venv/bin/activate

# 3. 텐서플로우 및 부품 설치
pip install -r requirements.txt

# 4. 터미널을 꺼도 봇이 계속 실행되도록 백그라운드(nohup) 실행
nohup python3 train_bot.py > bot_log.txt 2>&1 &
```

모든 배포가 끝났습니다! 이제 브라우저에서 `https://hand.dldcom.xyz` 로 접속하시면 HTTPS 보안이 적용된 상태로 카메라 접근 및 수어 페이지 이용이 완벽하게 작동할 것입니다. 봇이 잘 돌아가는지 로그를 확인하고 싶다면 `tail -f ~/hand/ai_bot/bot_log.txt` 를 입력하시면 됩니다.
