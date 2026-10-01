import { useEffect, useRef } from "react";
import * as echarts from "echarts";

export const PALETTE = {
  actual: "#a38bff",
  baseline: "#f2b84b",
  savings: "#69d58c",
  loss: "#ff7a7a",
  workload: "#5cc8e6",
  used: "#c9b8ff",
  requested: "#8e97ae",
  grid: "#1b2133",
  axis: "#5d6680",
  ink: "#eae7dc",
};

export const BASE_TEXT = {
  fontFamily: "IBM Plex Mono, ui-monospace, monospace",
  color: PALETTE.axis,
};

export const AXIS_COMMON = {
  axisLine: { lineStyle: { color: PALETTE.grid } },
  axisLabel: { ...BASE_TEXT, fontSize: 10.5 },
  splitLine: { lineStyle: { color: PALETTE.grid, type: "dashed" as const, opacity: 0.55 } },
  axisTick: { show: false },
};

export function tooltipBase() {
  return {
    backgroundColor: "#141823",
    borderColor: "#242c40",
    textStyle: { color: PALETTE.ink, fontFamily: "IBM Plex Mono, monospace", fontSize: 11.5 },
    extraCssText: "box-shadow: 0 8px 30px rgba(0,0,0,.5); border-radius: 10px;",
  } as const;
}

interface Props {
  option: echarts.EChartsOption;
  height?: number;
  onClick?: (params: { seriesName?: string; dataIndex?: number; name?: string; value?: unknown }) => void;
}

export default function Chart({ option, height = 360, onClick }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!host.current) return undefined;
    const c = echarts.init(host.current, undefined, { renderer: "canvas" });
    chart.current = c;
    if (onClick) c.on("click", onClick);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (chart.current) {
      chart.current.setOption(option, { notMerge: true });
      if (onClick) {
        chart.current.off("click");
        chart.current.on("click", onClick);
      }
    }
  }, [option, onClick]);

  return <div ref={host} style={{ width: "100%", height }} />;
}
