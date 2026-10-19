/** solarlunar 的 package.json "exports" 没带 types 条目，TS 解析不到它自带的 solarlunar.d.ts，
 *  这里按它的声明补一份（只声明用到的 lunar2solar） */
declare module "solarlunar" {
  interface SolarLunarResult {
    lYear: number;
    lMonth: number;
    lDay: number;
    isLeap: boolean;
    cYear: number;
    cMonth: number;
    cDay: number;
  }

  const solarLunar: {
    /** 农历转公历；农历数据范围外返回 -1 */
    lunar2solar(lunarYear: number, lunarMonth: number, lunarDay: number, isLeapMonth?: boolean): SolarLunarResult | -1;
    solar2lunar(year?: number, month?: number, day?: number): SolarLunarResult | -1;
  };

  export default solarLunar;
}
