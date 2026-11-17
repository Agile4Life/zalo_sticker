GiaoLang Sticker 0.2.1 — Windows x64 / Zalo PC 26.11.12

CÀI ĐẶT
1. Cài Zalo PC trước. Bộ cài này chỉ hỗ trợ đúng phiên bản 26.11.12
   và mã bảng sticker đã được kiểm tra. Phiên bản khác sẽ được báo rõ,
   không tự hạ cấp hoặc ghi đè.
2. Thoát hẳn Zalo: Cài đặt → Thoát (dấu X có thể chỉ thu nhỏ xuống khay).
3. Giải nén bộ cài này vào một thư mục, chạy install.cmd.
   Có thể chạy trong PowerShell: .\install.cmd
4. Mở lại Zalo → Sticker → ★.

Không cần cài Python, Node.js hoặc npm. Không cần quyền quản trị với
bản Zalo cài trong tài khoản người dùng. Nếu Zalo ở Program Files mà
Windows báo không có quyền ghi, chạy bộ cài bằng tài khoản có quyền ghi
vào đúng thư mục đó.

LỆNH
  .\install.cmd
  .\status.cmd
  .\uninstall.cmd

Chỉ kiểm tra, không thay tệp:
  .\GiaoLangStickerPatch.exe install --dry-run

Nếu không tự tìm thấy Zalo:
  .\GiaoLangStickerPatch.exe install --archive "D:\Zalo\Zalo-26.11.12\resources\app.asar"

XUẤT / NHẬP BỘ STICKER
- Gửi sticker từ iPhone vào Cloud của tôi rồi mở đoạn chat trên PC.
- Trong bảng ★, bấm Thêm → Từ đoạn chat → + → Xong,
  hoặc Thêm → Nhập ảnh (PNG/JPEG).
- Bấm Xuất ZIP để tải sticker-cua-toi.zip. Gửi ZIP đó cho bạn bè.
- Bạn bè cũng cài bản vá, mở ★ → Thêm → Nhập ZIP và chọn tệp nhận được.
- Nhập ZIP chỉ thêm sticker trên máy, không gửi tin nhắn.
- Ảnh trùng được bỏ qua khi nhập ZIP. Giới hạn: 200 sticker, 10 MB/ảnh,
  tổng 100 MB. ZIP chứa ảnh và tên sticker, không kèm tài khoản, phiên
  đăng nhập, nội dung chat hay đường dẫn CDN của người xuất.
- Nếu ảnh nguồn trên Zalo không còn đọc được, tải ảnh gốc và nhập lại
  trước khi xuất. Bộ cài không tự khôi phục ảnh đã hết hạn.
- Luồng ảnh tĩnh được kiểm tra bằng fixture. Sticker động/GIF và hiển
  thị thực tế phía người nhận vẫn cần kiểm tra với ảnh cụ thể.

GỠ VÀ SAO LƯU
Thoát hẳn Zalo rồi chạy uninstall.cmd, hoặc lệnh .\uninstall.cmd trong
PowerShell. Công cụ kiểm tra bản sao lưu, khôi phục app.asar gốc rồi
báo kết quả. Không xóa bộ sticker đã lưu và không đổi tài khoản.
Bản sao chương trình gốc nằm trong:
  %LOCALAPPDATA%\GiaoLangStickerPatch\<mã thư mục cài>\
Không xóa thư mục đó khi vẫn cần gỡ bản vá.
Bộ sticker trong dữ liệu cục bộ của Zalo không bị xóa khi gỡ bản vá.
Zalo tự cập nhật có thể cần bản vá mới phù hợp phiên bản mới.

Bộ cài không chứa app.asar của người tạo, dữ liệu tài khoản hoặc bộ
sticker riêng. Đây là tiện ích không chính thức, không thuộc Zalo/VNG.

THƯ VIỆN
fflate 0.8.3 (MIT): xem fflate-LICENSE.txt.
