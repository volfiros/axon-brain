export const ROLES = ["Admin", "Member", "Guest"] as const;
export type Role = (typeof ROLES)[number];
