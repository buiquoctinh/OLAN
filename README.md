# OLYMPIA APP – O LAN

Hệ thống thi đấu kiến thức chạy trong mạng LAN, không cần Internet khi thi.
Một máy chủ điều phối: màn hình **Điều khiển**, màn hình **LED** sân khấu và **4 máy đội thi**.

## Cài đặt và chạy

Yêu cầu: Node.js 18 trở lên (cài một lần trên máy chủ, cần Internet lúc `npm install`).

```bash
npm install
npm start          # hoặc: npm run dev (tự khởi động lại khi sửa server.js)
```

Cửa sổ dòng lệnh sẽ in địa chỉ LAN, ví dụ `http://192.168.1.10:3000`:

| Màn hình   | Địa chỉ              | Đăng nhập                          |
|------------|----------------------|------------------------------------|
| Điều khiển | `/admin`             | mật khẩu `adminPassword` trong `config.json` (chỉ dùng chữ không dấu) |
| LED        | `/led`               | không cần — bấm vào màn hình một lần để bật âm thanh và toàn màn hình |
| Đội 1–4    | `/team/1` … `/team/4` | mã PIN của từng đội trong `config.json` |

**Windows:** lần chạy đầu, cho phép Node.js qua Windows Firewall (mạng Private), nếu không các máy khác sẽ không vào được.
Nên đặt IP tĩnh cho máy chủ để địa chỉ không đổi giữa các buổi.

## Cấu hình — `config.json`

- `competition`: tên cuộc thi, khẩu hiệu và logo (hiện trên LED, màn hình chờ, intro, trang đội thi, trang điều khiển và biểu tượng tab trình duyệt). Logo nằm ở `media/images/logo.png` (nền trong suốt), kèm bản nhỏ `logo-256.png` và `logo-64.png`.

- `teams`: tên và mã PIN từng đội. **Đổi mật khẩu và PIN trước khi thi thật.**
- `answerTime`: số giây trả lời sau khi giành chuông (mặc định 5).
- `stealWindow`: số giây mở chuông cướp điểm.
- `scoring.khoidong`: đúng +10, sai −5.
- `scoring.vcnv.row`: điểm mỗi hàng ngang; `keywordByRowsOpened`: điểm giải từ khóa theo số hàng ngang đã mở (vị trí 0 = chưa mở hàng nào).
- `scoring.tangtoc`: điểm theo thứ tự trả lời đúng nhanh nhất (40/30/20/10).
- `scoring.vedich.stealWrongRatio`: tỷ lệ trừ khi cướp điểm sai (0.5 = trừ một nửa điểm câu; đặt 0 nếu thể lệ không trừ).

Sửa xong khởi động lại server.

## Ngân hàng câu hỏi

Bấm **Ngân hàng câu hỏi** trên thanh trên cùng của màn hình Điều khiển.

- Chọn phần thi ở cột trái: Khởi động, Vượt chướng ngại vật, Tăng tốc, Về đích 10/20/30 điểm, Câu hỏi phụ.
- **Thêm câu hỏi**, **Sửa**, **Xóa**, đổi thứ tự bằng **↑ ↓**. Lưu là có hiệu lực ngay, không cần khởi động lại.
- **Media đi kèm:** chọn loại (hình ảnh, video, âm thanh), rồi chọn file có sẵn hoặc **Tải file lên** trực tiếp từ máy điều khiển. File được lưu vào thư mục `media/`, tên file tự chuyển sang không dấu.
- **Vượt chướng ngại vật** cố định 4 hàng ngang (mỗi hàng gắn một góc hình) nên chỉ sửa, không thêm/xóa/đổi thứ tự. Từ khóa và hình chướng ngại vật sửa ở khung phía trên danh sách. Đáp án tự chuyển thành chữ hoa và hiển thị trước ô chữ sẽ lên LED.
- Không xóa được câu đang được chọn trên sân khấu; chọn câu khác trước.
- Mọi thay đổi ghi vào `data/questions.json`; bản ngay trước lần sửa gần nhất được giữ ở `data/questions.bak.json`, và thao tác được ghi vào nhật ký.

Vẫn có thể sửa trực tiếp `data/questions.json` rồi bấm **Nạp lại ngân hàng câu hỏi**. Định dạng một câu:

```json
{ "text": "Đây là công trình nào?", "answer": "Cầu Rồng", "time": 30,
  "media": { "type": "image", "src": "/media/images/cau-03.jpg" } }
```

## Điều khiển một câu hỏi

1. Chọn phần thi ở thanh trên, chọn câu ở cột trái.
2. **Hiện câu hỏi** (chỉ hiện) hoặc **Bắt đầu** (hiện + chạy đồng hồ + mở chuông / mở ô nhập đáp án). Phím tắt `S`.
3. Chấm **Đúng / Sai** ở thẻ từng đội. Mỗi đội chỉ được chấm một lần mỗi câu.
4. **Hiện đáp án** (phím `A`) để đưa đáp án lên LED và máy đội.

Theo phần thi:

- **Khởi động – Lượt riêng:** chọn đội đang thi ở khung vàng trên cùng cột **Các đội** (thẻ đội đang thi lên đầu, các đội khác mờ đi); mỗi đội có bộ 6 câu riêng (soạn trong Ngân hàng câu hỏi, mục "Lượt riêng – Đội N"). Không bấm chuông, 10 giây/câu, đúng +10, sai hoặc bỏ qua 0 điểm; chỉ chấm được đội đang thi.
  Mỗi câu: câu hỏi hiện ngay trên LED kèm tiếng "1 hien cau hoi"; nhạc nền "1-60s" vào sau tiếng này và chạy khi đồng hồ chạy, tạm dừng giữa các câu, có tiếng tích tắc đếm giờ; chấm xong câu cuối thì tắt nhạc nền và phát "1 hoan thanh".
- Cả hai lượt Khởi động: bấm **Hiện đáp án** phát "2 xem dap an".
- **Khởi động – Lượt chung:** cũng có tiếng "1 hien cau hoi", nhạc nền "1-60s" và tích tắc đếm giờ; khi có đội bấm chuông, nhạc nền dừng để chạy "4 5s", câu sau chạy tiếp. Câu cuối trả lời đúng thì phát "1 hoan thanh".
  Mẹo: bấm **Hiện câu hỏi** trước để tiếng mở câu hỏi phát trọn, rồi mới bấm **Bắt đầu**.
- **Khởi động – Lượt chung / Câu hỏi phụ:** Bắt đầu mở chuông; đội bấm trước có 5 giây. Đội sai bị khóa chuông; bấm **Mở chuông** để các đội còn lại bấm tiếp.
- **Vượt chướng ngại vật:** các đội gõ đáp án; chấm từng đội, rồi **Mở** hàng ngang (từng chữ lật lên trên LED, ô hình tương ứng lật theo) hoặc **✕** nếu không đội nào đúng. **Lật hình** mở cả 4 ô góc mà không lộ từ khóa. Giữa hình có **ô trung tâm** che lại, ô này chỉ mở khi từ khóa được công bố đủ (mở đủ từng chữ, bấm Công bố cả từ khóa, hoặc đội trả lời đúng từ khóa). Ảnh ô trung tâm đổi trong `config.json`, mục `vcnvSkin`. **Mở chuông từ khóa** bất kỳ lúc nào; đội giải sai bị loại khỏi phần thi; Từ khóa mở được **từng chữ cái**: bấm vào chữ trong khung "Từ khóa" ở cột trái (bấm lại để đóng), mỗi chữ phát "2 mo cau hoi"; mở đủ các chữ hoặc bấm **Công bố cả từ khóa** thì phát "2 tra loi dung(moi)".
  **Công bố đáp án các đội** chuyển LED sang màn hình đáp án: 4 đội theo thứ tự Đội 1 → 4, không hiện giây, đúng/sai hiện theo lúc chấm.
- **Tăng tốc:** các đội gõ đáp án, server ghi thời điểm gửi cuối cùng. Chấm Đúng/Sai, bấm **Cộng điểm theo thứ tự** rồi **Công bố đáp án các đội**: màn hình đáp án xếp từ nhanh đến chậm, kèm thời gian và điểm. **Hiện đáp án** phát "3 mo dap an".
- **Về đích:** thứ tự thi tự sắp theo điểm tăng dần. Chuyển sang Về đích không chạy intro, chỉ phát nhạc "4 mo dau". Chọn đội → **Màn hình chọn gói** (LED hiện 3 gói 40/60/80 kèm cơ cấu điểm, phát "4 cac goi cau hoi" rồi "4 lua chon goi cau hoi") → bấm gói (phát "4 chon goi", tiếng lấy từ video chọn gói): hai gói kia ẩn trước, gói được chọn ẩn sau, rồi LED trở về màn hình trả lời. Câu hỏi được nạp sẵn nhưng **ẩn** (khung chỉ ghi "CÂU HỎI 10 ĐIỂM"); bấm **Bắt đầu** thì câu hỏi mới hiện trên LED và máy đội, đồng hồ chạy cùng lúc. "Câu tiếp theo" cũng nạp ẩn như vậy. Ngân hàng không đủ câu thì báo trên màn hình điều khiển, không hiện lên LED. **Câu tiếp theo** để sang câu 2, 3 của gói. Bật **Ngôi sao hy vọng** trước khi bấm Bắt đầu nếu đội yêu cầu (sao vàng chỉ hiện dưới tên đội khi đang dùng). Nếu sai, bấm **Mở cướp điểm**. Chọn đội đang thi ở khung vàng trên cùng cột **Các đội** (thẻ đội đó lên đầu); thẻ các đội khác **không bị khóa**: đội nào giành quyền trả lời thì chấm Đúng/Sai ngay trên thẻ đội đó, tính theo luật cướp điểm (đúng: nhận điểm câu, đội đang thi bị trừ; sai: trừ một nửa); mỗi đội chỉ được chấm một lần mỗi câu. **Hiện đáp án** phát "2 xem dap an".
  Cơ cấu gói trong `config.json`, mục `vedichPackages` (mặc định 40 = 10+10+20, 60 = 10+20+30, 80 = 20+30+30); câu hỏi lấy lần lượt từ ngân hàng 10/20/30 điểm chưa dùng. Mục "Câu lẻ ngoài gói" để thay câu khi cần.

## Điểm trên màn hình LED

- LED chỉ hiển thị **điểm của phần thi đang diễn ra** (Khởi động gồm cả lượt riêng và lượt chung).
- Điểm tổng chỉ hiện khi Admin bấm **Công bố tổng điểm**: LED chuyển sang bảng xếp hạng từ cao xuống thấp; bấm lại để ẩn. Máy đội cũng chỉ thấy điểm tổng khi đã công bố.
- Admin luôn thấy cả điểm phần thi và điểm tổng ở thẻ từng đội.

## Intro chuyển phần thi

Mỗi lần chuyển phần thi, LED phát video intro của phần đó (`media/video/intro/…-HQ.mp4`), xong video thì phát nhạc mở đầu (`1/2/3/4 mo dau.mp3`).
Admin có **Chạy lại intro**, **Bỏ qua intro** và **Intro chương trình** (video `intro.mp4`, dùng lúc khai mạc).
Đổi video trong `config.json`, mục `intros` (để `""` thì dùng intro dựng sẵn có logo). Màn hình LED cần được bấm một lần lúc mở để trình duyệt cho phát âm thanh.

## Chuyển cảnh và màn hình chọn gói

- `config.json`, mục `transitions`: video chuyển cảnh trước khi hiện câu hỏi (mặc định tắt; file có sẵn trong `media/video/scene/`). Muốn dùng thì điền vào `src`: Khởi động "1 hien cau hoi.mp4", Vượt chướng ngại vật "2 mo cau hoi.mp4", Tăng tốc "3 mo cau hoi.mp4". Trong lúc chuyển cảnh, máy đội chưa thấy câu hỏi và đồng hồ chưa chạy.
- Mục `packageScreens`: mặc định để trống, LED dùng màn hình chọn gói dựng sẵn (`animSec` = thời gian hiệu ứng ẩn gói). Muốn dùng lại video thì điền `media/video/scene/4 lua chon goi cau hoi.mp4`, `chon40/60/80.mp4`.
- Mục `intros`: `"off"` = không chạy intro cho phần thi đó (mặc định Về đích), chỉ phát nhạc mở đầu.

## Âm thanh hiệu ứng

Âm thanh chỉ phát trên màn hình LED (nối loa sân khấu). File nằm trong `media/sound/`, giữ nguyên tên gốc; số đầu tên file là phần thi.
Bảng gán âm thanh nằm trong `config.json`, mục `sounds`. Muốn đổi: sửa tên file ở đó hoặc chép đè file cùng tên. Để `""` là tắt.

| Thao tác | KĐ lượt riêng | KĐ lượt chung / Câu phụ | Vượt chướng ngại vật | Tăng tốc | Về đích |
|---|---|---|---|---|---|
| Chuyển phần thi (sau video) | 1 mo dau | 1 mo dau | 2 mo dau | 3 mo dau | 4 mo dau |
| Chọn đội thi | 1 bat dau choi | | | | 4 bat dau choi |
| Chọn câu / hàng ngang | | | 2 chon hang ngang (new) | | |
| Hiện câu hỏi | | 1 hien cau hoi | 2 mo cau hoi | 3 mo cau hoi | |
| Nhạc đồng hồ | | | 2 15s | 3 30s | 4 10s / 4 15s / 4 20s |
| Bấm chuông | | 4. chuong | 4. chuong | | 4. chuong |
| Đồng hồ trả lời 5 giây, cướp điểm | | 4 5s | 4 5s | | 4 5s |
| Công bố đáp án các đội | | | 2 xem dap an | 3 mo dap an | |
| Chấm đúng | 1 tra loi dung | 1 tra loi dung | 2 tra loi dung(moi) | 3 tra loi dung | 4 tra loi dung |
| Chấm sai | 1 tra loi sai | 1 tra loi sai | 1 tra loi sai | 3 tra loi sai | 4 tra loi sai |
| Mở hàng ngang / lật ô hình | | | 2 mo o chu, 2 mo hinh anh | | |
| Ngôi sao hy vọng | | | | | ngoi sao hi vong |
| Công bố tổng điểm | tong ket diem + TONGKET1…4 (mỗi thanh một tiếng, đội dẫn đầu hiện sau cùng với TONGKET4) |||||

- **Nhạc đồng hồ** tự chọn file theo số giây và tua để kết thúc đúng lúc đồng hồ về 0 (ví dụ hàng ngang 10 giây phát 10 giây cuối của "2 15s"). Tạm dừng / tiếp tục đồng hồ thì nhạc dừng / chạy theo; chấm điểm hoặc chuyển câu thì nhạc tắt.
- Nên bấm **Hiện câu hỏi** trước rồi mới **Bắt đầu**: nhạc đồng hồ bắt đầu sẽ cắt tiếng "mở câu hỏi" nếu hai thao tác bấm sát nhau.
- **Bảng âm thanh** trên Admin phát tay mọi file (ví dụ "1 hoan thanh", "4 hoan thanh", "4 lua chon goi cau hoi", "4 cac goi cau hoi", "1-60s", "tongketketqua"); **Dừng âm thanh** tắt tất cả.
- Thêm file mới: chép vào `media/sound/`, khởi động lại server là có trên bảng âm thanh.

## Nguyên tắc an toàn

- Server là nguồn dữ liệu duy nhất: máy đội chỉ gửi được "bấm chuông" và "đáp án"; không sửa được điểm, đồng hồ hay chuyển câu.
- Đội bấm chuông trước là gói tin đến server trước — không dựa vào đồng hồ máy đội.
- Máy đội và LED không nhận đáp án đúng cho đến khi người điều khiển bấm Hiện đáp án.
- Điểm lưu tại `data/state.json` (server tắt/mở lại vẫn giữ điểm). Mọi thao tác ghi vào `data/log.jsonl` để đối chiếu khi có khiếu nại.
- Chế độ **Thi chính thức** yêu cầu nhập lại mật khẩu khi làm mới cuộc thi.

## Cấu trúc

```
server.js            máy chủ Express + Socket.IO, toàn bộ luật thi
config.json          đội, mật khẩu, thang điểm
data/questions.json  ngân hàng câu hỏi
public/              admin.html, led.html, team.html, index.html, common.js, common.css
media/               images, audio, video
```

Âm thanh lấy từ `media/sound/`; sự kiện nào chưa gán file thì dùng âm thanh tổng hợp dự phòng (Web Audio).

## Hướng phát triển tiếp

Nhập câu hỏi từ Excel, chuyển lưu trữ sang SQLite, Khởi động riêng từng đội, xuất biên bản kết quả.
