import moment from "moment";

export const formatJoinedTime = (
  joinedDate?: Date | string | null,
  baseDate: Date | string = new Date(),
): string => {
  if (!joinedDate) return "Chưa xác định";

  const start = moment(joinedDate);
  const end = moment(baseDate);

  // Nếu ngày tham gia không hợp lệ hoặc lớn hơn ngày hiện tại
  if (!start.isValid() || start.isAfter(end)) {
    return "null";
  }

  const diffYears = end.diff(start, "years");
  if (diffYears >= 1) {
    return `${diffYears} năm trước`;
  }

  const diffMonths = end.diff(start, "months");
  if (diffMonths >= 1) {
    return `${diffMonths} tháng trước`;
  }

  const diffWeeks = end.diff(start, "weeks");
  if (diffWeeks >= 1) {
    return `${diffWeeks} tuần trước`;
  }

  const diffDays = end.diff(start, "days");
  if (diffDays >= 1) {
    return `${diffDays} ngày trước`;
  }

  return "null";
};
