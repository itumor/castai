import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import Chart, { AXIS_COMMON, PALETTE, tooltipBase } from "./Chart";
import type { MergedMonth } from "../data2";
import { fmtSigned } from "../data2";

/** All methods overlaid: monthly gross by method vs CAST AI realized. */
export default function MethodCompare({ months }: { months: MergedMonth[] }) {
  const option = useMemo(() => {
    const xs = months.map((m) => m.month);
    const bar = (name: string, data: (number | null)[], color: string) => ({
      name,
      type: "bar" as const,
      data,
      barGap: "8%",
      itemStyle: { color, borderRadius: [3, 3, 0, 0] as number[] },
    });
    return {
      backgroundColor: "transparent",
      grid: { left: 70, right: 24, top: 44, bottom: 30 },
      legend: { top: 6, textStyle: { color: PALETTE.axis, fontSize: 10.5 }, icon: "roundRect", itemWidth: 12, itemHeight: 4 },
      tooltip: {
        ...tooltipBase(),
        trigger: "axis",
        formatter: (params: unknown) => {
          const ps = params as Array<{ seriesName?: string; axisValue?: string }>;
          const m = months.find((x) => x.month === ps[0]?.axisValue);
          if (!m) return "";
          const flagset = [...m.flags];
          const row = (c: string, n: string, v: string) =>
            `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="color:${c}">●</span> ${n}</span><span>${v}</span></div>`;
          return `<div style="font-size:11.5px;min-width:260px">
            <div style="color:#8e97ae;margin-bottom:5px">${m.month} · ${m.clusters} cluster${m.clusters === 1 ? "" : "s"}</div>
            ${row("#a38bff", "actual cost", `$${m.actual.toLocaleString("en-US", { maximumFractionDigits: 0 })}`)}
            ${row("#d0d3de", "M0 naive", fmtSigned(m.M0))}
            ${row("#f2b84b", "M1 frozen price", fmtSigned(m.M1))}
            ${row("#69d58c", "TR frozen (standard)", fmtSigned(m.TR))}
            ${row("#ffd166", "TR30D rolling", fmtSigned(m.TR30D))}
            ${row("#ff9ecb", "WMAX WA-aware", fmtSigned(m.WMAX))}
            ${row("#7cf0c0", "TRW TR+floor", fmtSigned(m.TRW))}
            ${row("#b39dff", "REQ demand-unit", fmtSigned(m.REQ))}
            ${row("#c9b8ff", "M2 OLS", fmtSigned(m.M2))}
            ${row("#5cc8e6", "M4 layers Σ", fmtSigned(m.M4))}
            ${row("#6f96ff", "CAST realized", fmtSigned(m.cast))}
            ${flagset.length ? `<div style="margin-top:6px;color:#ffcf77;font-size:10px">${flagset.join(" · ")}</div>` : ""}
          </div>`;
        },
      },
      xAxis: { type: "category", data: xs, ...AXIS_COMMON },
      yAxis: { type: "value", name: "gross $/month", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON },
      series: [
        bar("M0 naive", months.map((m) => m.M0), "#9aa1b2"),
        bar("M1 frozen", months.map((m) => m.M1), PALETTE.baseline),
        bar("TR ★", months.map((m) => m.TR), PALETTE.savings),
        bar("TR30D", months.map((m) => m.TR30D), "#ffd166"),
        bar("WMAX", months.map((m) => m.WMAX), "#ff9ecb"),
        bar("TRW", months.map((m) => m.TRW), "#7cf0c0"),
        bar("REQ", months.map((m) => m.REQ), "#b39dff"),
        bar("M2 OLS", months.map((m) => m.M2), PALETTE.used),
        {
          name: "M4 layers",
          type: "line",
          data: months.map((m) => m.M4),
          lineStyle: { color: PALETTE.workload, width: 2 },
          itemStyle: { color: PALETTE.workload },
          showSymbol: true,
        },
        {
          name: "CAST realized",
          type: "line",
          data: months.map((m) => m.cast),
          lineStyle: { color: "#6f96ff", width: 2 },
          itemStyle: { color: "#6f96ff" },
        },
      ],
    } as EChartsOption;
  }, [months]);
  return <Chart option={option} height={360} />;
}

/** Cumulative net savings per method over time. */
export function CumulativeCompare({ months }: { months: MergedMonth[] }) {
  const option = useMemo(() => {
    const xs = months.map((m) => m.month);
    const cum = (key: "M0net" | "M1net" | "TRnet" | "TR30Dnet" | "WMAXnet" | "TRWnet" | "REQnet" | "M2net" | "cast") => {
      let acc: number | null = null;
      return months.map((m) => {
        const v = m[key];
        if (v === null) return acc;
        acc = (acc ?? 0) + v;
        return acc;
      });
    };
    const s = (name: string, data: (number | null)[], color: string) => ({
      name, type: "line" as const, data, connectNulls: true,
      lineStyle: { color, width: 2 }, itemStyle: { color }, showSymbol: false,
      areaStyle: name.startsWith("TR net") ? {
        color: { type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: "rgba(105,213,140,0.16)" }, { offset: 1, color: "rgba(105,213,140,0)" }] },
      } : undefined,
    });
    return {
      backgroundColor: "transparent",
      grid: { left: 70, right: 24, top: 44, bottom: 30 },
      legend: { top: 6, textStyle: { color: PALETTE.axis, fontSize: 10.5 }, icon: "roundRect", itemWidth: 12, itemHeight: 4 },
      tooltip: { ...tooltipBase(), trigger: "axis" },
      xAxis: { type: "category", data: xs, ...AXIS_COMMON, boundaryGap: false },
      yAxis: { type: "value", name: "cumulative $", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON },
      series: [
        s("TR net (after €5/vCPU·mo fee) ★ standard", cum("TRnet"), PALETTE.savings),
        s("M1 net", cum("M1net"), PALETTE.baseline),
        s("M0 naive net", cum("M0net"), "#9aa1b2"),
        s("TR30D rolling net", cum("TR30Dnet"), "#ffd166"),
        s("WMAX net", cum("WMAXnet"), "#ff9ecb"),
        s("TRW net", cum("TRWnet"), "#7cf0c0"),
        s("REQ net", cum("REQnet"), "#b39dff"),
        s("M2 net", cum("M2net"), PALETTE.used),
        s("CAST realized", cum("cast"), "#6f96ff"),
      ],
    } as EChartsOption;
  }, [months]);
  return <Chart option={option} height={330} />;
}
