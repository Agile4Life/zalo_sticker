GiaoLang Sticker 0.2.1 — macOS (Apple Silicon hoặc Intel) / Zalo PC 26.11.10

BẠN CẦN BẢN NÀO?
  *-macOS-arm64.zip : Mac chip Apple (M1, M2, M3, M4...)
  *-macOS-x64.zip   : Mac chip Intel
Không chắc: menu  → Giới thiệu về máy Mac → "Chip" hoặc "Bộ xử lý".
Ứng dụng Zalo cho macOS là bản universal nên cùng một bản vá dùng được cho
cả hai loại chip; chỉ chương trình cài trong ZIP này khác nhau theo chip.

CÀI ĐẶT
1. Cài Zalo cho Mac vào /Applications trước. Bộ cài chỉ hỗ trợ đúng phiên bản
   26.11.10 và mã bảng sticker đã được kiểm tra. Phiên bản khác sẽ được báo
   rõ, không tự hạ cấp hoặc ghi đè.
2. Thoát hẳn Zalo (Zalo → Thoát Zalo, hoặc ⌘Q).
3. Giải nén ZIP vào một thư mục. File tải từ Internet bị macOS chặn lần đầu;
   mở Terminal và gỡ cờ chặn cho thư mục vừa giải nén:
     xattr -dr com.apple.quarantine /đường/dẫn/GiaoLangSticker-0.2.1-macOS-...
4. Bấm đúp install.command (hoặc chạy ./install.command trong Terminal).
5. Mở lại Zalo → Sticker → ★.

QUYỀN GHI VÀO ỨNG DỤNG
macOS 13 trở lên có thể báo "Operation not permitted" vì ứng dụng không được
sửa ứng dụng khác. Mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật →
"Quản lý ứng dụng" (hoặc "Toàn quyền truy cập đĩa"), bật cho Terminal, rồi
chạy lại.

LỆNH
  ./install.command
  ./status.command
  ./uninstall.command

Chỉ kiểm tra, không thay tệp:
  ./GiaoLangStickerPatch install --dry-run

Nếu không tự tìm thấy Zalo:
  ./GiaoLangStickerPatch install --archive "/Applications/Zalo.app/Contents/Resources/app.asar"

CHỮ KÝ ỨNG DỤNG VÀ CẬP NHẬT
Bộ cài chỉ thay một tệp: Zalo.app/Contents/Resources/app.asar. Không ký lại
ứng dụng và không sửa Info.plist, nên Zalo giữ nguyên danh tính (keychain,
quyền micro/camera). Hệ quả: chữ ký "con dấu" của Zalo.app không còn khớp
cho đến khi gỡ bản vá; "codesign --verify" sẽ báo lỗi trong thời gian đó.
Zalo tự cập nhật sẽ ghi đè bản vá; cần bản vá mới cho phiên bản mới.

XUẤT / NHẬP BỘ STICKER
- Gửi sticker từ iPhone vào Cloud của tôi rồi mở đoạn chat trên Mac.
- Trong bảng ★, bấm Thêm → Từ đoạn chat → + → Xong,
  hoặc Thêm → Nhập ảnh (PNG/JPEG).
- Bấm Xuất ZIP để tải sticker-cua-toi.zip. Gửi ZIP đó cho bạn bè.
- Bạn bè cũng cài bản vá, mở ★ → Thêm → Nhập ZIP và chọn tệp nhận được.
- Giới hạn: 200 sticker, 10 MB/ảnh, tổng 100 MB.

GỠ VÀ SAO LƯU
Thoát hẳn Zalo rồi chạy ./uninstall.command. Công cụ kiểm tra bản sao lưu và
khôi phục đúng tệp app.asar gốc (giống từng byte). Không xóa bộ sticker đã lưu.
Bản sao lưu nằm trong:
  ~/Library/Application Support/GiaoLangStickerPatch/<mã thư mục cài>/
Không xóa thư mục đó khi vẫn cần gỡ bản vá.

Bộ cài không chứa app.asar của người tạo, dữ liệu tài khoản hoặc bộ
sticker riêng. Đây là tiện ích không chính thức, không thuộc Zalo/VNG.

THƯ VIỆN
fflate 0.8.3 (MIT): xem fflate-LICENSE.txt.
