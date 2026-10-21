export const DEFAULT_HOURLY_RATE = 13.9;

export function salaryToMinutes(monthlySalary: number, hourlyRate: number): number {
  if (!Number.isFinite(monthlySalary) || monthlySalary < 0 || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    throw new Error("Lương tháng phải từ 0; lương giờ phải lớn hơn 0.");
  }
  const minutes = Math.round(monthlySalary / hourlyRate * 60);
  if (!Number.isSafeInteger(minutes)) throw new Error("Số tiền quá lớn.");
  return minutes;
}
