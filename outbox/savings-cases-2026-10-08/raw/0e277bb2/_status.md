01 GET external-clusters/0e277bb2-036d-485f-8690-4bf22720af9f -> 200
02 GET external-clusters/0e277bb2-036d-485f-8690-4bf22720af9f/nodes -> 200
03 GET baseline-params -> 404
04 GET workloads-summary -> 200
05 GET cost-reports savings 2026-09-08..2026-10-08 -> 400
06 POST runValueRealizationReport body={clusterIds} 2026-09-05..2026-10-05 -> 200
07 GET workloads-summary-metrics?startTime,endTime -> 200
