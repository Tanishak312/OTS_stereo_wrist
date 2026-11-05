# Drive upload kit: Head + wrist

Head + wrist ka sample (270 episodes, 50 h, ~1.42 TB) R2 se Google Drive folder
`Head_wrist_sample_OTS` me daalta hai. Windows ya Linux, kisi bhi machine par chalta hai.
Head + wrist ka MCAP nahi hai, isliye har episode me teen MP4 aur calibration jate hain.

**Beech me ruk jaye to wahi command dobara chala do.** Script pehle Drive dekhti hai, jo files
sahi size me aa chuki hain unhe skip karti hai, aur sirf baaki bhejti hai.

## Drive me kya banega

```
Home/<Skill>/<episode_id>/
    head/head_synced.mp4              stereo head camera
    wrist_left/wrist_left_synced.mp4
    wrist_right/wrist_right_synced.mp4
    head/, wrist_left/, wrist_right/  calibration.json, calibration.bin, updated_calibration.json,
                                      device.json, imu.csv, mag.csv, frames.csv
```

Sirf yahi files jati hain. Baaki files (`location_metadata.json`, `submission_analytics.json`,
`left.mp4`, `right.mp4`) jaan-boojhkar nahi jati.

- `episodes.csv`: har episode ka environment, skill, task, duration, size aur Drive folder
- `files.csv`: har file ki list, script isi se chalti hai

## Time

1.42 TB, 90 Mbps upload par ~35 ghante. **Drive ek account se ~750 GB per day leta hai**, to ~2 din
lagenge. Limit par script khud ruk jayegi aur message degi. 24 ghante baad wahi command chala do.
Ego kit bhi agar isi account se usi din chal raha hai, to dono ka data us 750 GB me judta hai.

## Sabse pehle

Yeh kit ek hi machine par chalana. Do machines par ek saath chalane se duplicate files ban sakti hain.

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
rclone config create ots-drive-hw drive scope=drive root_folder_id=1bI-SBuQoiDI3K4Gs1dQwPKIikyoNfMi7
```
Browser khulega. `tanishak.singhal@awign.com` se sign in karke **Allow** dabao.

Agar machine par browser nahi hai (Linux server):

1. Server par: `rclone config create ots-drive-hw drive scope=drive root_folder_id=1bI-SBuQoiDI3K4Gs1dQwPKIikyoNfMi7 config_is_local=false`
2. Wo jo `rclone authorize ...` command dikhaye, use laptop par chalao aur browser me Allow karo.
3. Laptop par jo token aaye, use server par paste karo.

Is login se rclone ko aapke poore Drive ka access milta hai. `rclone.conf` file kisi ko mat dena.

## Chalana

Pehle test. Isse kuch nahi badalta:
```
python upload.py --check
```
Linux par `python` ki jagah `python3` likho.

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

- `upload.log`: kitne episodes ho gaye, kya fail hua
- `rclone.log`: speed aur errors
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
| `Stopped at Drive's daily upload limit` | Normal hai. 24 ghante baad wahi `--run` chalao |
| `STOPPED: R2 read key missing` | `.env` banao aur dono values bharo |
| `R2 read failed` | `.env` ki read key check karo |
| `couldn't list ots-drive-hw:` | Google login dobara karo (step 3) |
| Internet gaya, machine band hui | Wahi `--run` command dobara chalao |
| `FAILED` | Script khud 3 baar koshish karti hai. Phir bhi bache to `rclone.log` dekho aur `--run` dobara chalao |
| `duplicates` 0 se zyada | Do machines par chala hoga. Files delete mat karo, Claude ko batao |

Khatam hone par `All files are on Drive and every size matches.` dikhega.
