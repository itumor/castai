import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import Chart, { AXIS_COMMON, PALETTE, tooltipBase } from "./Chart";
import type { MergedDay } from "../data2";

/** Organic demand vs current requests vs provisioned (deep-tier days only). */
export default function DemandLines({ days }: { days: MergedDay[] }) {
  const option = useMemo(() => {
    const xs = days.map((d) => d.date);
    const req = days.map((d) => (d.reqCpu > 0 ? +d.reqCpu.toFixed(1) : null));
    const used = days.map((d) => (d.usedCpu > 0 ? +d.usedCpu.toFixed(1) : null));
    const prov = days.map((d) => (d.vcpu > 0 ? +d.vcpu.toFixed(1) : null));
    const line = (name: string, data: (number | null)[], color: string, dash?: boolean) => ({
      name, type: "line" as const, data, connectNulls: true, showSymbol: false,
      lineStyle: { color, width: dash ? 1.4 : 2.2, type: (dash ? "dashed" : "solid") as "dashed" | "solid" },
      itemStyle: { color },
    });
    return {
      backgroundColor: "transparent",
      grid: { left: 62, right: 24, top: 42, bottom: 30 },
      legend: { top: 6, textStyle: { color: PALETTE.axis, fontSize: 11 }, icon: "roundRect", itemWidth: 14, itemHeight: 4 },
      tooltip: { ...tooltipBase(), trigger: "axis", valueFormatter: (v: unknown) => `${Number(v ?? 0).toFixed(1)} vCPU` },
      xAxis: { type: "category", data: xs, ...AXIS_COMMON, boundaryGap: false },
      yAxis: { type: "value", name: "vCPU", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON },
      series: [
        line("provisioned (nodes)", prov, "#a38bff"),
        line("requests after WOOP", req, PALETTE.requested),
        line("actually used", used, PALETTE.workload),
      ],
      dataZoom: [{ type: "inside", throttle: 40 }],
    } as EChartsOption;
  }, [days]);
  return <Chart option={option} height={300} />;
}
