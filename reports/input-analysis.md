# Phân tích input trước khi tối ưu lịch

Ngày kiểm tra: 24/10/2026. Nguồn: restaurantData.ts, stores.ts. Chưa xác nhận dữ liệu người dùng đã chỉnh trong trình duyệt; không thay đổi hợp đồng.

| Nhân viên | Giờ tháng | Bộ phận | Giới hạn cứng riêng | Ưu tiên mềm | Vai trò khi chia lịch |
|---|---:|---|---|---|---|
| Ngoc Long Nguyen | 120 | Bồi/Bếp | Chưa khai báo | Chưa khai báo | Phải dành ngân sách cho cả hai bộ phận; mỗi thời điểm chỉ một vị trí |
| Ngoc Ly Ly Nguyen | 174 | Bồi | Chưa khai báo | Ca 6h | Nguồn Bồi chính ngày thường, đầu ngày và chiều |
| Van Diep Mai | 93 | Bếp | Hết làm sau 31/10/2026 | Chưa khai báo | Phủ Bếp cùng Kien, Hoang; không dùng từ tháng 11/2026 |
| Thi Huong Bui | 43 | Bồi | Chỉ T6, T7, CN | Chưa khai báo | Phủ ngày cuối tuần trước khi dùng giờ linh hoạt |
| Van Kien Nguyen | 86 | Bếp | Chưa khai báo | Chưa khai báo | Phủ phần Bếp còn thiếu theo ngày và khung giờ |
| Dinh Bien Nguyen | 43 | Bồi | Chỉ 18:00–21:30 | Chưa khai báo | Phủ tối, đóng cửa; không thể bù trống trưa/chiều |
| Thai Hung Nguyen | 14,39 | Bồi | Chỉ T6, T7, CN | Chưa khai báo | Phủ bổ sung cuối tuần; lưới 30 phút hiện chỉ xếp 14h |
| Tran Dinh Hoang | 150 | Bếp | Tối đa 5 ngày/tuần | Ca 6h | Phải chọn ngày nghỉ dựa trên khả năng thay thế của Diep, Kien, Long |

Các nhân viên chưa đặt ca cố định, ngày bắt đầu, khoảng nghỉ theo ngày hoặc khung giờ ưu tiên. Trừ ngoại lệ trong bảng, có thể làm trong giờ mở 11:00–21:30. Không có input nghỉ riêng giữa hai mốc giờ trong ngày. Ca liền, nghỉ giải lao, tối đa 8h công/ngày và 6 ngày liên tiếp vẫn áp dụng.

## Ngân sách theo bộ phận — luật mới 24/10/2026

Bắt buộc có ít nhất một Bồi và một Bếp liên tục 11:00–14:00, 17:00–20:00. Khung 14:00–17:00 và sau 20:00 cho phép thiếu, còn giờ thì phủ thêm. Ca vẫn liền; không dùng khoảng ít khách để tự tạo ca gãy.

Tháng 1/2026 có 31 ngày: yêu cầu bắt buộc 186h mỗi bộ phận, tổng 372h. Ngân sách trên lưới là 723h: Bồi riêng 274h, Bếp riêng 329h, Long linh hoạt 120h.

- Huong và Hung chỉ làm T6–CN: tận dụng các ngày này trước; Ly Ly và Long có thể bù ngày thường, không khóa họ chỉ được làm ngày thường.
- Tháng 1/2026 có 14 ngày T6–CN, cần 84h Bồi cho hai khung bắt buộc. Huong + Hung có 57h trên lưới, thiếu 27h để tự phủ nhóm ngày này; Bien có thể bù buổi tối, hoặc dùng Ly Ly/Long. Đây là chuyển giờ trong ngân sách hiện có, không phải yêu cầu tăng hợp đồng.
- Bien chỉ làm 18:00–21:30: dùng cho buổi tối; cần Bồi khác phủ 17:00–18:00 và buổi trưa.
- Không khóa toàn bộ Bồi linh hoạt chỉ vào ngày thường: từ 11h đến 20h trải 9 giờ, vượt ca 8h công + 30 phút giải lao. Một người không thể tự phủ cả hai khung; vẫn phải có người giao ca, Long chuyển vai hoặc nhân viên khác hỗ trợ từng đoạn.
- Hoang tối đa 5 ngày/tuần: ngày nghỉ phải phối hợp Kien, Diep, Long. Khi thiếu Bếp, Long có thể chuyển vai; không tính hai vị trí cùng lúc.
- Mức 51,5h Long phải bù Bồi và thiếu ít nhất 21h tháng 12 trong phân tích trước chỉ áp dụng mục tiêu phủ cả ngày. Với luật mới, không được dùng các số đó để yêu cầu khách tăng giờ.
- Từ tháng 11/2026, Diep không còn làm: ngân sách 630h. Tháng 12 cần 372h cho khung bắt buộc; chưa có cận dưới ngân sách chứng minh cần thêm giờ.
- Tổng giờ không chứng minh khả thi theo từng ngày. Phải kiểm thử ca liền, ngày nghỉ, giải lao, đủ giờ hợp đồng và độ phủ thực tế.

## Thứ tự cần dùng khi thiết kế thuật toán

1. Chuẩn hóa input thực tế theo tháng: ngày đủ điều kiện, khung giờ, số ngày tối đa, phút hợp đồng và khả năng Bồi/Bếp.
2. Tính nhu cầu và khả năng đáp ứng theo từng ngày, từng vị trí, từng mốc 30 phút; tính người linh hoạt một lần.
3. Phân bổ ngân sách linh hoạt cho từng bộ phận trước; ưu tiên lựa chọn ít người có thể thay thế. Đặt quyết định ngày nghỉ và ca cùng bài toán phủ giờ.
4. Ưu tiên phủ ít nhất một Bồi và một Bếp trong các khung bắt buộc, đủ giờ hợp đồng và mọi giới hạn cứng; sau đó mới phân phần dư cho cao điểm, cân bằng ngày tương đương và ca mong muốn.
5. Khi còn trống, thử chuyển giờ từ đoạn đang dư hoặc đổi ngày/ca trong giới hạn hiện có. Chỉ đề xuất nới input sau khi phân biệt được thiếu ngân sách với lỗi tìm kiếm.

Đã cập nhật luật, ưu tiên tìm kiếm và báo cáo theo khung bắt buộc. Vẫn cần đối chiếu dữ liệu đang lưu trên trang trước khi coi dữ liệu mặc định là input thực tế của lịch người dùng.
