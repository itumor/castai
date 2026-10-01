import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import Chart, { AXIS_COMMON, PALETTE, tooltipBase } from "./Chart";
import type { MergedDay } from "../data2";

/** M4 three-layer attribution, stacked per day (WOOP-era days only). */
export default function LayerChart({ days }: { days: MergedDay[] }) {
  const option = useMemo(() => {
    const rows = days.filter((d) => d.lw !== null || d.ln !== null || d.lp !== null);
    const xs = rows.map((d) => d.date);
    const zero = (v: number | null | undefined) => (v ?? 0);
    const bar = (name: string, data: number[], color: string) => ({
      name, type: "bar" as const, stack: "m4", data, itemStyle: { color },
    });
    return {
      backgroundColor: "transparent",
      grid: { left: 70, right: 24, top: 42, bottom: 30 },
      legend: { top: 6, textStyle: { color: PALETTE.axis, fontSize: 11 }, icon: "roundRect", itemWidth: 12, itemHeight: 4 },
      tooltip: {
        ...tooltipBase(),
        trigger: "axis",
        formatter: (params: unknown) => {
          const ps = params as Array<{ axisValue?: string }>;
          const d = rows.find((x) => x.date === ps[0]?.axisValue);
          if (!d) return "";
          const lw = zero(d.lw), ln = zero(d.ln), lp = zero(d.lp);
          const row = (c: string, n: string, v: number) =>
            `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="color:${c}">●</span> ${n}</span><span>${v < 0 ? "−" : "+"}$${Math.abs(v).toFixed(0)}</span></div>`;
          return `<div style="font-size:11.5px;min-width:250px">
            <div style="color:#8e97ae;margin-bottom:5px">${d.date}</div>
            ${row("#5cc8e6", "L_W WOOP demand", lw)}
            ${row("#69d58c", "L_N node packing", ln)}
            ${row("#c9b8ff", "L_P price/family", lp)}
            <div style="border-top:1px dashed #2a3148;margin-top:4px;padding-top:4px;display:flex;justify-content:space-between">
              <span>gross (telescoping Σ)</span><span>$${(lw + ln + lp).toFixed(0)}</span>
            </div>
          </div>`;
        },
      },
      xAxis: { type: "category", data: xs, ...AXIS_COMMON },
      yAxis: { type: "value", name: "$/day", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON },
      series: [
        bar("L_W WOOP demand", rows.map((d) => +zero(d.lw).toFixed(2)), "#5cc8e6"),
        bar("L_N node packing", rows.map((d) => +zero(d.ln).toFixed(2)), "#69d58c"),
        bar("L_P price/family", rows.map((d) => +zero(d.lp).toFixed(2)), "#c9b8ff"),
      ],
    } as EChartsOption;
  }, [days]);
  return <Chart option={option} height={320} />;
}
