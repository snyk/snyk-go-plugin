/**
 * Latest patch release of each Go minor version, from
 * https://go.dev/dl/?mode=json&include=all
 *
 * Update when a new Go patch or minor version is released.
 */
export const LATEST_GO_PATCH_BY_MINOR: Readonly<Record<string, number>> = {
  '1.12': 17,
  '1.13': 15,
  '1.14': 15,
  '1.15': 15,
  '1.16': 15,
  '1.17': 13,
  '1.18': 10,
  '1.19': 13,
  '1.20': 14,
  '1.21': 13,
  '1.22': 12,
  '1.23': 12,
  '1.24': 13,
  '1.25': 14,
  '1.26': 11,
  '1.27': 4,
};
