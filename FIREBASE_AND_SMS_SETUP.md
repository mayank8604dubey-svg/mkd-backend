# MKD Messenger — Firebase & Real SMS Setup Guide

This guide details how to configure real SMS phone verification for MKD Messenger on physical Android devices.

---

## 1. Authentication Architecture

MKD supports two enterprise-grade authentication engines:

| Engine | Description | When to Use |
| :--- | :--- | :--- |
| **MKD Production Backend (Twilio / Gateway)** | Independent REST SMS API hosted on your Node.js/PostgreSQL server. Dispatches SMS via Twilio or HTTP SMS gateway. | **Recommended for production**; complete data sovereignty and works on all Android devices without Google Play Services dependencies. |
| **Firebase Phone Auth** | Google's managed phone verification service with SMS dispatch and SafetyNet/Play Integrity verification. | When you want Google to manage SMS quotas, rate limiting, and verification tokens. |

---

## 2. Option A: MKD Production Backend SMS (Recommended)

### Step 1: Configure Environment Variables
In `backend/.env` (copy from `backend/.env.example`):

#### Using Twilio:
```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://mkd_user:mkd_secure_password_2026@localhost:5432/mkd_messenger

# SMS Provider
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX
```

#### Using Any Generic HTTP SMS Gateway (MSG91, Fast2SMS, TextLocal, Vonage):
```env
SMS_PROVIDER=http
SMS_GATEWAY_URL=https://api.gateway.com/send?apiKey={apiKey}&to={to}&message={message}
SMS_GATEWAY_API_KEY=your_gateway_api_key
```

### Step 2: Start the Backend Server
```bash
cd backend
npm run build
npm start
```

### Step 3: Connect Physical Phone to Your Backend
1. Ensure your Android phone and development computer are connected to the same Wi-Fi network.
2. Find your computer's local IP address:
   - On Windows: Run `ipconfig` in Command Prompt (look for IPv4 Address, e.g., `192.168.1.50`).
   - On macOS/Linux: Run `ifconfig` or `ip a`.
3. Open **MKD Messenger** on your phone.
4. On the **Enter your phone number** screen, tap the **Server Settings icon (🖥️ / DNS)** in the top-right corner.
5. Enter: `http://192.168.1.50:3000/` (replace with your actual IP) and tap **Save & Connect**.
6. Enter your real mobile number and tap **Next**. Your backend will send a real 6-digit OTP code directly to your mobile phone via SMS!

---

## 3. Option B: Firebase Phone Authentication

If you prefer to use Google Firebase for SMS delivery:

### Step 1: Create a Project in Firebase Console
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and name it (e.g. `MKD Messenger`).
3. Click **Add app** and select the **Android** icon.
4. Enter the Package Name: `com.mkd.messenger`.
5. Enter the App Nickname: `MKD`.

### Step 2: Add SHA-1 and SHA-256 Fingerprints (Required for Phone Auth)
Firebase requires the SHA fingerprint of your signing key to verify SMS requests and app authenticity.

Run the following command in the project directory:
```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.21.102-hotspot"
.\.tools\gradle-8.7\bin\gradle.bat signingReport
```
Look for `Variant: debug` -> `SHA1:` and `SHA-256:`.

Alternatively, use `keytool`:
```bash
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

In Firebase Console:
1. Go to **Project Settings** (gear icon) -> **Your Apps** -> select `com.mkd.messenger`.
2. Click **Add fingerprint**.
3. Paste both your **SHA-1** and **SHA-256** fingerprints.

### Step 3: Enable Phone Authentication
1. In the Firebase Console left menu, go to **Build** -> **Authentication**.
2. Click **Get Started** (if not already enabled).
3. Under the **Sign-in method** tab, click **Phone**.
4. Toggle **Enable** to ON.
5. (Optional for testing) Under **Phone numbers for testing**, you can add your phone number with a fixed verification code (e.g. `+1 650-555-1234` with `123456`) to test without burning SMS quota.
6. Click **Save**.

### Step 4: Download and Replace `google-services.json`
1. In Firebase Console -> **Project Settings** -> **General** -> **Your apps**.
2. Click **Download google-services.json**.
3. Replace the placeholder file at:
   `D:\Projects\New1\app\google-services.json`
4. Rebuild the app with `.\.tools\gradle-8.7\bin\gradle.bat assembleDebug`.

---

## 4. Testing & Verification Checklist

- [x] Real E.164 phone number formatting with country codes.
- [x] Real 6-digit SMS OTP dispatched to physical phone.
- [x] Secure session token exchange (`accessToken` + `refreshToken`).
- [x] User profile creation & persistence across app restarts.
- [x] Device address book synchronization with contact invitation via SMS.
