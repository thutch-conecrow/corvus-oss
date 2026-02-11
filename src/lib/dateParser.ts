/**
 * Parse fuzzy date strings into timestamps.
 * Handles patterns like "June 2024", "June 19, 2025", "last summer", "6 months ago", etc.
 * Returns null if the string can't be parsed.
 */

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse a fuzzy date string into a timestamp (milliseconds since epoch).
 * Returns null if parsing fails.
 */
export function parseFuzzyDate(input: string | undefined): number | null {
  if (!input) return null;

  const str = input.toLowerCase().trim();
  const now = new Date();

  // Try exact date formats first: "June 19, 2025" or "June 19 2025" or "19 June 2025"
  const exactMatch = str.match(
    /^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$|^(\d{1,2})(?:st|nd|rd|th)?\s+(\w+),?\s*(\d{4})$/
  );
  if (exactMatch) {
    const [, month1, day1, year1, day2, month2, year2] = exactMatch;
    const monthStr = month1 || month2;
    const day = parseInt(day1 || day2, 10);
    const year = parseInt(year1 || year2, 10);
    const month = MONTHS[monthStr];
    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day).getTime();
    }
  }

  // Month and year: "June 2024" or "Jun 2024"
  const monthYearMatch = str.match(/^(\w+),?\s*(\d{4})$/);
  if (monthYearMatch) {
    const [, monthStr, yearStr] = monthYearMatch;
    const month = MONTHS[monthStr];
    const year = parseInt(yearStr, 10);
    if (month !== undefined && year >= 1900 && year <= 2100) {
      // Use middle of the month (15th) for better approximation
      return new Date(year, month, 15).getTime();
    }
  }

  // Quarter: "Q1 2025", "Q2 2024"
  const quarterMatch = str.match(/^q([1-4])\s*(\d{4})$/);
  if (quarterMatch) {
    const [, q, yearStr] = quarterMatch;
    const year = parseInt(yearStr, 10);
    const quarter = parseInt(q, 10);
    // Middle of the quarter
    const month = (quarter - 1) * 3 + 1; // Q1=1 (Feb), Q2=4 (May), Q3=7 (Aug), Q4=10 (Nov)
    return new Date(year, month, 15).getTime();
  }

  // Relative: "X months ago", "X weeks ago", "X years ago"
  const relativeMatch = str.match(/^(\d+)\s*(day|week|month|year)s?\s*ago$/);
  if (relativeMatch) {
    const [, numStr, unit] = relativeMatch;
    const num = parseInt(numStr, 10);
    const result = new Date(now);
    switch (unit) {
      case "day":
        result.setDate(result.getDate() - num);
        break;
      case "week":
        result.setDate(result.getDate() - num * 7);
        break;
      case "month":
        result.setMonth(result.getMonth() - num);
        break;
      case "year":
        result.setFullYear(result.getFullYear() - num);
        break;
    }
    return result.getTime();
  }

  // Seasons: "last summer", "summer 2024", "fall 2023"
  const seasonMatch = str.match(/^(?:last\s+)?(\w+)(?:\s+(\d{4}))?$/);
  if (seasonMatch) {
    const [, season, yearStr] = seasonMatch;
    let year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
    let month: number | null = null;

    switch (season) {
      case "spring":
        month = 3; // April
        break;
      case "summer":
        month = 6; // July
        break;
      case "fall":
      case "autumn":
        month = 9; // October
        break;
      case "winter":
        month = 0; // January
        break;
    }

    if (month !== null) {
      // "last summer" means previous year if we haven't reached that season yet
      if (str.startsWith("last")) {
        year = now.getFullYear() - 1;
      }
      return new Date(year, month, 15).getTime();
    }
  }

  // Year only: "2024", "2025"
  const yearOnlyMatch = str.match(/^(\d{4})$/);
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1], 10);
    if (year >= 1900 && year <= 2100) {
      // Middle of the year
      return new Date(year, 5, 15).getTime(); // June 15
    }
  }

  // "early/mid/late [month] [year]" or "early/mid/late [year]"
  const periodMatch = str.match(/^(early|mid|late)\s+(\w+)(?:\s+(\d{4}))?$/);
  if (periodMatch) {
    const [, period, second, yearStr] = periodMatch;
    const month = MONTHS[second];

    if (month !== undefined) {
      // "early June 2024"
      const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
      let day = 15;
      if (period === "early") day = 5;
      if (period === "late") day = 25;
      return new Date(year, month, day).getTime();
    } else if (/^\d{4}$/.test(second)) {
      // "early 2024"
      const year = parseInt(second, 10);
      let month = 5; // June (mid-year)
      if (period === "early") month = 1; // February
      if (period === "late") month = 10; // November
      return new Date(year, month, 15).getTime();
    }
  }

  // Couldn't parse
  return null;
}

/**
 * Parse a fuzzy date, falling back to the current time if parsing fails.
 */
export function parseFuzzyDateOrNow(input: string | undefined): number {
  return parseFuzzyDate(input) ?? Date.now();
}
