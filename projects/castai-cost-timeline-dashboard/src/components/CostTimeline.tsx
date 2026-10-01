import { useMemo } from "react";
import type { EChartsOption, SeriesOption } from "echarts";
import Chart, { AXIS_COMMON, PALETTE, tooltipBase } from "./Chart";
import type { EventRow2, MergedDay } from "../data2";

interface Props {
  days: MergedDay[];
  events: EventRow2[];
  method: string; // M0 | M1 | TR | TR30D | WMAX | TRW | REQ | M2
  showCast: boolean;
  onPickDate?: (date: string | null) => void;
}

const METHOD_LABEL: Record<string, string> = {
  M0: "M0 · naive flat-demand baseline",
  M1: "M1 · frozen vCPU price",
  TR: "TR · frozen CPU+RAM ★",
  TR30D: "TR30D · rolling 30-day baseline",
  WMAX: "WMAX · WA-aware counterfactual",
  TRW: "TRW · TR ✚ WA demand floor",
  REQ: "REQ · demand-unit (docs 05/06)",
  M2: "M2 · OLS two-factor",
};

export default function CostTimeline({ days, events, method, showCast, onPickDate }: Props) {
  const option = useMemo(() => {
    const dates = days.map((d) => d.date);
    const actual = days.map((d) => +d.actual.toFixed(2));
    const adj = days.map((d) =>
      method === "M0"
        ? (d.M0 !== null ? +(d.actual + d.M0).toFixed(2) : null)
        : method === "M1"
          ? d.adjM1
          : method === "TR"
            ? d.adjTR
            : method === "TR30D"
              ? d.adjTR30D
              : method === "WMAX"
                ? d.adjWmax
                : method === "TRW"
                  ? d.adjTRW
                  : method === "REQ"
                    ? d.adjREQ
                    : d.adjM2,
    );
    const gross = days.map((d) =>
      method === "M0" ? d.M0 : method === "M1" ? d.M1 : method === "TR" ? d.TR : method === "TR30D" ? d.TR30D : method === "WMAX" ? d.WMAX : method === "TRW" ? d.TRW : method === "REQ" ? d.REQ : d.M2,
    );
    const castProj = days.map((d) => d.castProjected);
    const vcpu = days.map((d) => +d.vcpu.toFixed(1));

    const series: SeriesOption[] = [
      {
        name: "baseline (frozen)",
        type: "line",
        data: adj,
        connectNulls: true,
        lineStyle: { color: PALETTE.baseline, width: 2, type: "dashed", opacity: 0.9 },
        itemStyle: { color: PALETTE.baseline },
        showSymbol: false,
        z: 3,
      },
      {
        name: "actual cost",
        type: "line",
        data: actual,
        lineStyle: { color: PALETTE.actual, width: 2.4 },
        itemStyle: { color: PALETTE.actual },
        showSymbol: false,
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(163,139,255,0.25)" },
              { offset: 1, color: "rgba(163,139,255,0.01)" },
            ],
          },
        },
        z: 4,
      },
    ];
    if (showCast) {
      series.push({
        name: "CAST AI projected (their counterfactual)",
        type: "line",
        data: castProj,
        connectNulls: true,
        lineStyle: { color: "#6f96ff", width: 1.6, opacity: 0.85 },
        itemStyle: { color: "#6f96ff" },
        showSymbol: false,
        z: 2,
      } as SeriesOption);
    }
    series.push(
      {
        name: "gross savings (selected method)",
        type: "bar",
        data: gross,
        itemStyle: {
          color: (p: { value?: number }) =>
            (p.value ?? 0) >= 0 ? "rgba(105,213,140,0.55)" : "rgba(255,122,122,0.55)",
        },
        z: 1,
      } as SeriesOption,
      {
        name: "avg vCPU provisioned",
        type: "line",
        yAxisIndex: 1,
        data: vcpu,
        lineStyle: { color: PALETTE.workload, width: 1.1, opacity: 0.55 },
        itemStyle: { color: PALETTE.workload },
        showSymbol: false,
        z: 2,
      } as SeriesOption,
    );

    // markLines: autoscaler switch per cluster (deduped by date)
    const switchDates = [...new Set(events.filter((e) => e.type === "woop-installed").map((e) => e.date))];
    const markData = switchDates.map((d) => ({
      xAxis: d,
      lineStyle: { color: "#ffcf77", type: "solid" as const, width: 1.2, opacity: 0.7 },
      label: { formatter: "autoscaler switch", color: "#ffcf77", fontSize: 10 },
    }));

    if (markData.length && series[1]) {
      (series[1] as { markLine?: object }).markLine = { silent: true, symbol: "none", data: markData };
    }

    return {
      backgroundColor: "transparent",
      grid: { left: 62, right: 62, top: 46, bottom: 34 },
      legend: {
        top: 6, textStyle: { color: PALETTE.axis, fontSize: 11 },
        icon: "roundRect", itemWidth: 14, itemHeight: 4,
      },
      tooltip: {
        ...tooltipBase(),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: "#3a4360" } },
        formatter: (params: unknown) => {
          const ps = params as Array<{ seriesName?: string; value?: unknown; axisValue?: string }>;
          const d = days.find((x) => x.date === ps[0]?.axisValue);
          if (!d) return "";
          const sign = (v: number | null) =>
            v === null ? "—" : `${v < 0 ? "−" : "+"}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
          const money = (v: number | null) =>
            v === null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
          const ev = events.filter((e) => e.date === d.date);
          const gsel = method === "M0" ? d.M0 : method === "M1" ? d.M1 : method === "TR" ? d.TR : method === "TR30D" ? d.TR30D : method === "WMAX" ? d.WMAX : method === "TRW" ? d.TRW : method === "REQ" ? d.REQ : d.M2;
          const adjsel = method === "M0" ? (d.M0 !== null ? d.actual + d.M0 : null) : method === "M1" ? d.adjM1 : method === "TR" ? d.adjTR : method === "TR30D" ? d.adjTR30D : method === "WMAX" ? d.adjWmax : method === "TRW" ? d.adjTRW : method === "REQ" ? d.adjREQ : d.adjM2;
          const rows: Array<[string, string, string]> = [
            ["#f2b84b", `${METHOD_LABEL[method]} (baseline)`, money(adjsel)],
            ["#a38bff", "actual", money(d.actual)],
            ["#69d58c", `gross ${"gross" === "gross" ? "" : ""}(${method})`, sign(gsel)],
          ];
          if (showCast && d.castProjected !== null) {
            rows.push(["#6f96ff", "CAST projected", money(d.castProjected)]);
            rows.push(["#6f96ff", "CAST realized", sign(d.cast)]);
          }
          rows.push(["#5cc8e6", "avg vCPU", d.vcpu.toFixed(1)]);
          const html = `<div style="font-size:11.5px;min-width:240px">
            <div style="color:#8e97ae;margin-bottom:6px">${d.date}</div>
            ${rows.map(([c, n, v]) => `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="color:${c}">●</span> ${n}</span><span>${v}</span></div>`).join("")}
            ${ev.length ? `<div style="margin-top:6px;border-top:1px dashed #2a3148;padding-top:5px;color:#ffcf77">${ev.length} event${ev.length > 1 ? "s" : ""} — click any point to inspect day</div>` : ""}
          </div>`;
          return html;
        },
      },
      xAxis: { type: "category", data: dates, ...AXIS_COMMON, boundaryGap: false },
      yAxis: [
        { type: "value", name: "$/day", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON },
        { type: "value", name: "vCPU", nameTextStyle: { color: PALETTE.axis, fontSize: 10 }, ...AXIS_COMMON, splitLine: { show: false } },
      ],
      series,
      dataZoom: [{ type: "inside", throttle: 40 }],
    } as EChartsOption;
  }, [days, events, method, showCast]);

  return (
    <Chart
      option={option}
      height={420}
      onClick={(p) => {
        if (onPickDate) {
          const d = days[p.dataIndex ?? -1];
          onPickDate(d ? d.date : null);
        }
      }}
    />
  );
}
