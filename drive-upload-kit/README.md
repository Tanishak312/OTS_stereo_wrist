# Drive upload kit

Option B ka Ego-centric sample (184 MCAP files, 50 h, ~200 GB) R2 se Google Drive folder
`Ego_sample_OTS` me daalta hai. Windows ya Linux, kisi bhi machine par chalta hai.

**Beech me ruk jaye to wahi command dobara chala do.** Script pehle Drive dekhti hai, jo files
sahi size me aa chuki hain unhe skip karti hai, aur sirf baaki bhejti hai.

## Sabse pehle

**Purani machine par upload band karo.** Do machines par ek saath chala to Drive me same naam ki
duplicate files ban sakti hain.

- Laptop wala upload Claude ne chalaya hai, to use bolo "laptop ka upload rok do".
- Kisi aur machine par: jis terminal me chal raha ho wahan `Ctrl+C`.

## Setup (sirf ek baar)

**1. Python 3.8+ aur rclone install karo**

Windows:
```
winget install Python.Python.3.12
winget install Rclone.Rclone
```
Install ke baad terminal band karke naya kholo.

Linux:
```
sudo apt install -y python3
curl https://rclone.org/install.sh | sudo bash
```

**2. Yeh folder machine par copy karke `.env` banao**

`.env.example` ki copy banao, naam `.env` rakho, aur dono `R2_READ_...` values bharo.
Values `OTS_live_project/.env` me hain. Sirf **read** key daalna, write key kabhi nahi.

**3. Google login**

Agar machine par browser hai:
```
rclone config create ots-drive drive scope=drive root_folder_id=1_DpLNyxouYYN5H1jqWQ52iyzzudktAlM
```
Browser khulega. `tanishak.singhal@awign.com` se sign in karke **Allow** dabao.

Agar machine par browser nahi hai (Linux server):

1. Server par: `rclone config create ots-drive drive scope=drive root_folder_id=1_DpLNyxouYYN5H1jqWQ52iyzzudktAlM config_is_local=false`
2. Wo jo `rclone authorize ...` command dikhaye, use laptop par chalao aur browser me Allow karo.
3. Laptop par jo token aaye, use server par paste karo.

Is login se rclone ko aapke poore Drive ka access milta hai. `rclone.conf` file kisi ko mat dena.

## Chalana

Pehle test. Isse kuch nahi badalta:
```
python upload.py --check
```
Linux par `python` ki jagah `python3` likho. Yeh batayega ki R2 aur Drive kaam kar rahe hain aur
kitni files baaki hain.

Sab theek ho to upload:
```
python upload.py --run
```

**Linux server par** terminal band hone par bhi chalta rahe, iske liye:
```
nohup python3 upload.py --run > run.out 2>&1 &
tail -f upload.log
```

**Windows par** PC ka sleep band kar do: Settings > System > Power > Sleep > Never.

## Progress dekhna

- `upload.log`: kitni files ho gayi, kya fail hua
- `rclone.log`: har file ki speed aur errors
- Dusre terminal me `python upload.py --check`: Drive par asli count

## Agar files 100% par atak jayein

`rclone.log` me `403 Quota exceeded` dikhe to yeh aapke account ki limit nahi hai. `rclone` ka default Google
app duniya bhar ke users share karte hain, aur wo limit bhar jati hai. File 100% tak jakar reject hoti hai aur
dobara bhejni padti hai, isliye speed bahut gir jati hai. rclone yeh shared app band bhi karne wala hai.

Bade upload se pehle apna Google client bana lo (10 minute, free):

1. [console.cloud.google.com](https://console.cloud.google.com) me naya project banao aur **Google Drive API** enable karo.
2. **OAuth consent screen**: type **Internal** chuno.
3. **Credentials > Create credentials > OAuth client ID**, type **Desktop app**. Client ID aur secret copy karo.
4. Google login wali command me yeh dono jod kar dobara chalao: `client_id=<id> client_secret=<secret>`

Steps: https://rclone.org/drive/#making-your-own-client-id

## Kuch galat ho jaye

| Dikha | Kya karna hai |
|---|---|
| `STOPPED: R2 read key missing` | `.env` banao aur dono values bharo |
| `R2 read failed` | `.env` ki read key check karo |
| `couldn't list ots-drive:` | Google login dobara karo (step 3) |
| Internet gaya, machine band hui | Wahi `--run` command dobara chalao |
| `FAILED` | Script khud 3 baar koshish karti hai. Phir bhi bache to `rclone.log` dekho aur `--run` dobara chalao |
| `duplicates` 0 se zyada | Do machines par chala hoga. Files delete mat karo, Claude ko batao |

Khatam hone par `All files are on Drive and every size matches.` dikhega. `files.csv` me har
file ka environment, skill, duration, size aur Drive path hai.
