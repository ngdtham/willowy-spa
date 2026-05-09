# WILLOWY SPA - Hệ Thống Quản Lý Đặt Lịch (Tóm Tắt Triển Khai)

Tài liệu này tóm tắt toàn bộ cấu trúc và thông tin cần thiết để vận hành, bảo trì và nâng cấp hệ thống Willowy Spa.

## 1. Kiến Trúc Hệ Thống
*   **Frontend**: HTML/CSS/JS thuần, triển khai trên **Vercel** (kết nối qua GitHub).
    *   Tệp tin chính: `index.html` (Thư mục gốc và `public/index.html`).
*   **Backend**: **Google Apps Script (GAS)** xử lý logic database và thông báo.
    *   Tệp tin chính: `Code.gs`.
*   **Database**: **Google Sheets** lưu trữ thông tin khách hàng, dịch vụ, nhân viên và lịch đặt.
    *   ID bảng tính: `13Ud3Y5IiogcNMpoGw7irKLdgpOH4ANBJrYdF4f0Q7wg`

## 2. Thông Tin Cấu Hình (Bảo Mật)
*   **API URL (trong index.html)**: `https://script.google.com/macros/s/AKfycbzyfSdGC1HTLaZWeU5HeuyEuCWfFdgcCA9sOWeliJ42W4oH5ishONdenSnc0ZSSyyg5/exec`
*   **Tài khoản Admin**:
    *   User: `willowy_admin`
    *   Pass: `adminadmin` (Đã được băm SHA-256 khi gửi qua API).

## 3. Danh Mục Dịch Vụ (23 Dịch Vụ Mới Nhất)
Hệ thống đã đồng bộ hóa 23 dịch vụ chia làm 6 nhóm chính:
1.  **Gội đầu (H1 - H4)**: Giá từ 70k - 299k.
2.  **Da dầu mụn (SO1 - SO4)**: Giá từ 449k - 549k.
3.  **Da khô & Xỉn màu (SD1 - SD4)**: Giá từ 399k - 699k.
4.  **Chống lão hóa (SA1 - SA4)**: Giá từ 449k - 799k.
5.  **Chăm sóc cơ thể (BS, BW, CB)**: Làm sạch và dưỡng sáng.
6.  **Massage cơ thể (B1 - B4)**: Thư giãn tay, chân, vai gáy và toàn thân.

## 4. Các Tính Năng Quan Trọng Đã Hoàn Thiện
*   **Admin Login Modal**: Thay thế hộp thoại prompt lỗi thời bằng Modal chuyên nghiệp, tránh lỗi gợi ý mật khẩu của trình duyệt.
*   **Quick Book**: Cho phép đặt lịch trực tiếp từ trang chủ mà không cần qua trang chọn dịch vụ.
*   **Đồng bộ hóa tự động**: Hàm `setupServicesData` trong `Code.gs` tự động ghi 23 dịch vụ mới vào Google Sheet để khớp với giao diện.
*   **Thông báo Telegram**: Tự động gửi tin nhắn báo lịch mới về Bot Telegram.

## 5. Quy Trình Cập Nhật & Triển Khai
### Cập nhật Giao diện (Frontend):
1.  Chỉnh sửa tệp `index.html`.
2.  Dùng lệnh Git: `git add .`, `git commit -m "nội dung"`, `git push origin main`.
3.  Vercel sẽ tự động build lại sau 1-2 phút.

### Cập nhật Logic (Backend):
1.  Chỉnh sửa tệp `Code.gs` trong trình soạn thảo Apps Script.
2.  **BẮT BUỘC**: Chọn **Deploy** -> **Manage deployments** -> **Edit** bản hiện tại -> **Version: New Version** -> **Deploy**.
3.  Lấy URL API mới (nếu có thay đổi lớn) cập nhật vào hằng số `API_URL` trong `index.html`.

## 6. Xử Lý Sự Cố Thường Gặp
*   **Trang trắng/Lỗi giao diện**: Luôn nhấn **Ctrl + F5** để xóa cache trình duyệt.
*   **Đặt lịch bị lỗi "create_booking_failed"**: Kiểm tra xem `Code.gs` đã được Deploy phiên bản mới nhất chưa.
*   **Thông tin dịch vụ/giá bị cũ**: Chạy hàm `setupServicesData` trong `Code.gs` để đồng bộ lại dữ liệu xuống Google Sheet.

---
*Tài liệu được lập ngày 09/05/2026 bởi Antigravity AI Assistant.*
