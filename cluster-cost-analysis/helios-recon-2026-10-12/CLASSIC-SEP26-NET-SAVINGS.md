# Siemens AG enterprise — CLASSIC savings API, September 2026, fees & net

**Basis:** `GET /v1/cost-reports/clusters/{id}/savings?startTime=2026-09-01T00:00:00Z&endTime=2026-10-01T00:00:00Z&stepSeconds=86400` per cluster · fees = enterprise billing (phase2) × $5.00/$5.70. 71 clusters in scope (56 billed ∪ VR rows); **49 returned classic data; 22 answered 400 'cluster is read-only'** (not CAST-managed at cluster level — listed at bottom; their fees are NOT netted into the classic totals since classic gives them no savings number).

## Organization roll-up (classic basis)

| Organization | Clusters w/ classic data | Classic cost $ | Classic gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| SI GSW CLO | 6 | 81,814 | 43,120 | 3,531.32 | 17,656.58 | 20,128.50 | **+25,464** | **+22,992** |
| SI EA electrificationx | 3 | 7,244 | 7,605 | 640.73 | 3,203.65 | 3,652.17 | **+4,401** | **+3,953** |
| IT IPS | 10 | 35,851 | 2,732 | 1,736.25 | 8,681.23 | 9,896.61 | **-5,949** | **-7,164** |
| SI B SW | 10 | 1,673 | 2,678 | 70.41 | 352.03 | 401.31 | **+2,326** | **+2,277** |
| CPS | 2 | 17,504 | 1,311 | 544.43 | 2,722.17 | 3,103.28 | **-1,411** | **-1,792** |
| HAFAS H&O | 3 | 15,862 | 1,014 | 630.33 | 3,151.66 | 3,592.89 | **-2,138** | **-2,579** |
| Siemens Dev | 3 | 1,213 | 814 | 71.97 | 359.84 | 410.22 | **+454** | **+403** |
| Pillar#1 | 1 | 2,994 | 358 | 5.02 | 25.12 | 28.64 | **+333** | **+330** |
| CYS - CNAPP | 1 | 192 | 178 | 9.61 | 48.03 | 54.75 | **+130** | **+123** |
| SMO-SW-PDH-TPS | 1 | 70 | 117 | 4.24 | 21.21 | 24.17 | **+96** | **+93** |
| DI AUT PI APF | 1 | 651 | 44 | 26.42 | 132.12 | 150.62 | **-88** | **-106** |
| SI-EP-EMS-R&D | 2 | 1,261 | 20 | 28.02 | 140.08 | 159.69 | **-121** | **-140** |
| CASE | 1 | 0 | 0 | 0.00 | 0.00 | 0.00 | **+0** | **+0** |
| DI IT DEX CLD | 1 | 0 | 0 | 0.00 | 0.00 | 0.00 | **+0** | **+0** |
| DI SW PRS AMER SLC | 1 | 847 | 0 | 41.28 | 206.40 | 235.30 | **-206** | **-235** |
| evosoft IT MIS | 1 | 493 | 0 | 22.70 | 113.50 | 129.39 | **-114** | **-129** |
| FT-FT RPD CED SSI-IIP | 1 | 37 | 0 | 4.12 | 20.59 | 23.48 | **-21** | **-23** |
| FT-RDP-SSP-DEVOPSFF-EKS-DEV | 1 | 0 | 0 | 0.00 | 0.00 | 0.00 | **+0** | **+0** |
| **Σ ENTERPRISE (classic)** | **49.0** | **167,706** | **59,991** | **7,366.85** | **36,834.23** | **41,991.02** | **+23,157** | **+18,000** |

## CASE

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| shining-star | shining-star#641078483763#eu-central-1 | `ef2ddd68-7577-4b2b-a1fc-34dc18392249` | eu-central-1 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |

## CPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| dema-platform-services | dema-platform-services#373270804851#eu-central-1 | `5dc3bf31-a263-4c6b-88bb-e95b6403aa51` | eu-central-1 | 17,040 | 1,249 | 0 | **1,249** | 527.54 | 2,637.72 | 3,007.01 | -1,389 | -1,758 |
| dema-platform-services-test | dema-platform-services-test#373270804851#eu-central-1 | `00ee8944-67f6-43d5-8517-c270951ec02c` | eu-central-1 | 464 | 62 | 0 | **62** | 16.89 | 84.45 | 96.27 | -22 | -34 |

## CYS - CNAPP

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| wiz-outpost-lite | wiz-outpost-lite#890988596583#eu-central-1 | `95bf32c8-ced4-4a81-9665-f3c6278f5f57` | eu-central-1 | 192 | 178 | 0 | **178** | 9.61 | 48.03 | 54.75 | 130 | 123 |

## DI AUT PI APF

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| dev-cluster | dev-cluster#660922352913#eu-central-1 | `7e04bd70-0513-4c6b-8b38-42b6c46905d9` | eu-central-1 | 651 | 44 | 0 | **44** | 26.42 | 132.12 | 150.62 | -88 | -106 |

## DI IT DEX CLD

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gspkafka-k8s-dev | gspkafka-k8s-dev#203629096770#eu-central-1 | `99b2dce3-a9ef-4b75-898f-3c375b253f8e` | eu-central-1 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |

## DI SW PRS AMER SLC

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Posit | Posit#483428953713#us-east-1 | `893e4362-bb07-417a-b53c-f9b011b4240d` | us-east-1 | 847 | 0 | 0 | **0** | 41.28 | 206.40 | 235.30 | -206 | -235 |

## evosoft IT MIS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ITMIS | ITMIS#864981718205#eu-central-1 | `31864129-b09c-47b2-a8df-c616f98d65b7` | eu-central-1 | 493 | 0 | 0 | **0** | 22.70 | 113.50 | 129.39 | -114 | -129 |

## FT-FT RPD CED SSI-IIP

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| CDM-EKS-Cluster | CDM-EKS-Cluster#904494280429#eu-central-1 | `62aa894c-1d41-4a7a-98ed-e181e289e173` | eu-central-1 | 37 | 0 | 0 | **0** | 4.12 | 20.59 | 23.48 | -21 | -23 |

## FT-RDP-SSP-DEVOPSFF-EKS-DEV

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| eks-dev | eks-dev#096367275314#eu-central-1 | `54535938-4437-42d5-b5f5-bc4a2f90ce8b` | eu-central-1 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |

## HAFAS H&O

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| eks | eks#933753214448#eu-central-1 | `8a9c0f55-86fc-4142-8f72-17ae6171a3aa` | eu-central-1 | 3,060 | 520 | 0 | **520** | 144.09 | 720.44 | 821.31 | -200 | -301 |
| eks | eks#106391900725#eu-central-1 | `22bf2472-d9ba-4cb3-b6ec-1f7aab50cb3f` | eu-central-1 | 770 | 100 | 178 | **278** | 40.00 | 199.98 | 227.98 | 78 | 50 |
| eks | eks#688967701480#eu-central-1 | `953f87e7-9175-435b-ad3b-1a3b8a4e7cad` | eu-central-1 | 12,032 | 215 | 0 | **215** | 446.25 | 2,231.24 | 2,543.61 | -2,016 | -2,328 |

## IT IPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| eleX01 | eleX01#576061914293#eu-central-1 | `f0fa2ea7-48db-4473-b6b3-c73123fa0dac` | eu-central-1 | 6,463 | 1,038 | 0 | **1,038** | 332.68 | 1,663.42 | 1,896.30 | -626 | -859 |
| eleX01 | eleX01#546544527727#us-east-2 | `7b646d74-cc78-4703-a14f-865b3c0451bf` | us-east-2 | 5,588 | 519 | 0 | **519** | 327.00 | 1,635.02 | 1,863.92 | -1,116 | -1,345 |
| eleX01in | eleX01in#637423451488#ap-south-1 | `cf027570-8275-4d1d-a2e1-f9ffbb713f9e` | ap-south-1 | 3,301 | 377 | 0 | **377** | 336.34 | 1,681.71 | 1,917.15 | -1,305 | -1,541 |
| pioneer-tcx | pioneer-tcx#136905788720#eu-central-1 | `a4ee9bce-da9e-4cae-8eda-caeb0b5ab20a` | eu-central-1 | 948 | 301 | 0 | **301** | 24.56 | 122.81 | 140.00 | 178 | 161 |
| aks-dios-weu-prod-001 | b5d4cd12-98b2-4e9f-90a1-4db0134337c4 | `b5d4cd12-98b2-4e9f-90a1-4db0134337c4` | westeurope | 2,728 | 265 | 0 | **265** | 50.34 | 251.69 | 286.93 | 13 | -22 |
| aks-dios-weu-test-001 | b01c58a4-4ad2-4756-b729-e0cf07b8fba6 | `b01c58a4-4ad2-4756-b729-e0cf07b8fba6` | westeurope | 1,261 | 190 | 0 | **190** | 28.01 | 140.06 | 159.67 | 50 | 30 |
| eagle-kafka01 | eagle-kafka01#897825492946#eu-central-1 | `ef65cdd5-853a-46d3-9694-6d93edd6ad2d` | eu-central-1 | 1,143 | 37 | 0 | **37** | 47.53 | 237.65 | 270.92 | -201 | -234 |
| eleX01p | eleX01p#976594908632#eu-central-1 | `823f9475-109e-4a8a-bed1-c1fba8441882` | eu-central-1 | 12,914 | 7 | 0 | **7** | 540.23 | 2,701.13 | 3,079.29 | -2,694 | -3,073 |
| kafka-test | kafka-test#187494036103#eu-central-1 | `06a44e72-8f49-4f6f-a2f5-2092d14cffe4` | eu-central-1 | 398 | 0 | 0 | **0** | 16.51 | 82.53 | 94.08 | -83 | -94 |
| iec-tcx-flat | iec-tcx-flat#987708558949#eu-central-1 | `c783a2f5-d6c9-4c93-9bbe-216d2c614903` | eu-central-1 | 1,106 | 0 | 0 | **0** | 33.04 | 165.21 | 188.34 | -165 | -188 |

## Pillar#1

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| console-eks-integ | console-eks-integ#238720913587#us-east-1 | `d909c528-e5d0-4ebd-8c1a-77ad9b76a54b` | us-east-1 | 2,994 | 358 | 0 | **358** | 5.02 | 25.12 | 28.64 | 333 | 330 |

## SI B SW

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#972571274142#eu-west-1 | `dc10bd6a-1552-4c4b-9173-fc11b50c610f` | eu-west-1 | 434 | 2,502 | 148 | **2,650** | 29.17 | 145.85 | 166.27 | 2,504 | 2,484 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#675913176182#eu-west-1 | `3782e6c8-4780-42cb-bada-97b096ee21f7` | eu-west-1 | 70 | 9 | 0 | **9** | — | 0.00 | 0.00 | 9 | 9 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#018471890419#us-east-1 | `dc42abdf-7485-4115-a23e-a623f63fc12f` | us-east-1 | 195 | 8 | 0 | **8** | — | 0.00 | 0.00 | 8 | 8 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#018471890419#eu-west-1 | `01c18e7a-ce06-4c12-b921-c93e612d3bf0` | eu-west-1 | 239 | 3 | 0 | **3** | 11.34 | 56.71 | 64.65 | -53 | -61 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#290851856511#eu-west-1 | `6436c787-9169-4b3a-907c-d18776efeb19` | eu-west-1 | 195 | 3 | 0 | **3** | 9.37 | 46.84 | 53.40 | -44 | -51 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#380349240159#eu-west-1 | `6c94cd80-978f-4d9c-926e-df0e43dbb93f` | eu-west-1 | 174 | 2 | 0 | **2** | 6.38 | 31.90 | 36.36 | -30 | -34 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#877314709291#us-east-1 | `99cb56e0-50f9-4ad7-a803-d03da4d95513` | us-east-1 | 193 | 2 | 0 | **2** | 5.88 | 29.40 | 33.51 | -28 | -32 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#183098873491#eu-west-1 | `fd1ca573-4982-4133-89ce-bfd4df4f5d7b` | eu-west-1 | 172 | 2 | 0 | **2** | 8.27 | 41.34 | 47.13 | -40 | -46 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#380349240159#us-east-2 | `e3c91abe-69ae-4a79-b362-90f42e1917c0` | us-east-2 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#023510080489#eu-west-1 | `1b0450f7-5532-4edd-af65-a754ff33ff40` | eu-west-1 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |

## SI EA electrificationx

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| eks-Cluster1 | eks-Cluster1#955761008245#eu-central-1 | `c6cdf969-f81c-4324-a498-89008dce1351` | eu-central-1 | 4,068 | 502 | 4,375 | **4,878** | 369.75 | 1,848.76 | 2,107.59 | 3,029 | 2,770 |
| eks-Cluster1 | eks-Cluster1#129753847697#eu-central-1 | `f31e9de1-7884-470e-95ce-11c9f5dcfe0d` | eu-central-1 | 2,977 | 459 | 2,267 | **2,726** | 264.67 | 1,323.34 | 1,508.60 | 1,403 | 1,218 |
| eks-Cluster1 | eks-Cluster1#955761008245#eu-north-1 | `1ca6667a-06af-497f-a7ae-b9e7748c9493` | eu-north-1 | 199 | 1 | 0 | **1** | 6.31 | 31.56 | 35.97 | -31 | -35 |

## SI GSW CLO

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ngm-helios-eks | ngm-helios-eks#600442974479#eu-central-1 | `419c39e4-66bf-4d61-b833-4562968a61c7` | eu-central-1 | 45,095 | 18,878 | 0 | **18,878** | 1,850.51 | 9,252.56 | 10,547.91 | 9,625 | 8,330 |
| ngm-integ-eks | ngm-integ-eks#600442974479#eu-central-1 | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` | eu-central-1 | 22,047 | 18,512 | 0 | **18,512** | 1,049.92 | 5,249.58 | 5,984.52 | 13,263 | 12,528 |
| ngm-kronos-eks | ngm-kronos-eks#600442974479#eu-central-1 | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` | eu-central-1 | 1,939 | 3,501 | 0 | **3,501** | 89.69 | 448.43 | 511.21 | 3,053 | 2,990 |
| baseline-clo-eks | baseline-clo-eks#110201440604#eu-central-1 | `02810f4b-b793-4ef2-95f1-e902af61d9e3` | eu-central-1 | 2,552 | 1,351 | 0 | **1,351** | 114.79 | 573.96 | 654.32 | 777 | 697 |
| ngm-sim-eks | ngm-sim-eks#894875834901#eu-central-1 | `51dd234c-a5bf-4f99-a884-b79956de8f94` | eu-central-1 | 8,052 | 442 | 0 | **442** | 359.19 | 1,795.97 | 2,047.41 | -1,354 | -1,605 |
| ngm-sim2-eks | ngm-sim2-eks#894875834901#eu-central-1 | `8bd361b0-fcbf-491d-beac-af92fb7d6b46` | eu-central-1 | 2,127 | 435 | 0 | **435** | 67.22 | 336.08 | 383.13 | 99 | 52 |

## SI-EP-EMS-R&D

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| cluster | cluster#471112794282#eu-central-1 | `67a9bd91-0edf-40f9-8429-e14f3707a750` | eu-central-1 | 787 | 20 | 0 | **20** | 9.43 | 47.17 | 53.78 | -28 | -34 |
| cluster | cluster#480007738569#eu-west-1 | `95276912-9b38-42d6-91d5-a388fc0280d2` | eu-west-1 | 474 | 0 | 0 | **0** | 18.58 | 92.91 | 105.91 | -93 | -106 |

## Siemens Dev

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| pfm-eks-cluster | pfm-eks-cluster#955761008245#eu-west-1 | `de02aae4-1fd1-401a-ad47-345711d4d7b3` | eu-west-1 | 906 | 82 | 709 | **790** | 71.97 | 359.84 | 410.22 | 430 | 380 |
| dev-vlab-cluster | dev-vlab-cluster#488218212374#eu-central-1 | `0528411e-4d89-4fcf-af04-1b496541025d` | eu-central-1 | 307 | 23 | 0 | **23** | — | 0.00 | 0.00 | 23 | 23 |
| sp-tofu-simple | sp-tofu-simple#027851298014#eu-central-1 | `dac52e3e-1576-479c-b61e-f33589de026f` | eu-central-1 | 0 | 0 | 0 | **0** | 0.00 | 0.00 | 0.00 | 0 | 0 |

## SMO-SW-PDH-TPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Classic cost $ | Downscaling $ | Spot $ | **Classic gross savings $** | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| eks-tpslive-dev | eks-tpslive-dev#522814722959#eu-central-1 | `d119d612-84ad-4c79-9992-a120b7206f15` | eu-central-1 | 70 | 117 | 0 | **117** | 4.24 | 21.21 | 24.17 | 96 | 93 |

## Clusters with no classic data (400 read-only)

| Organization | Cluster | CAST AI cluster ID | Billable vCPU | Fee $ @5.00 | Reason |
|---|---|---|---:|---:|---|
| ? | ? | `06cbc64f-209b-43af-8037-089966f2368b` | 0.00 | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| ? | ? | `7d062a35-e537-459e-8412-d4089161c0ee` | 0.02 | 0.11 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| FT FDS CES | iemc-cluster-dev | `dd0b548e-f6e0-4b50-b14c-13b2cc26ba48` | 0.01 | 0.04 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| FT FDS CES | iemc-cluster-int | `25c0a174-d4b6-48d7-9459-f3240f97a1a8` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| FT FDS CES | iemc-cluster-ipcei-test | `6f77cf09-c22b-46ba-8e41-3ea270f65c26` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| Pillar#1 | console-eks-preprod | `a8129ccd-1dd4-441c-aaee-babd56ea5dc3` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| Pillar#1 | fgac-eks-integ | `b97e51e0-b4d7-42b3-a50a-ad29b9ab6b4d` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| Pillar#1 | fgac-eks-preprod | `cce8c41d-bf31-4c7e-bfff-dd2f8f0cd519` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| Pillar#1 | gw-eks-integ | `514bf38c-5235-44b6-a951-8e69528b5943` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| Pillar#1 | gw-eks-preprod | `c086341f-ab62-4abc-90c8-a9ace1b45426` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SI GSW CLO | alliander-demo-eks | `c686f800-f17f-4b9a-8b7e-7655f209e07f` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SI GSW CLO | ngm-data-eks | `9b9d2d51-ec75-46d4-bac0-ba38253cb8d9` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `0e277bb2-036d-485f-8690-4bf22720af9f` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `4952c4ce-6a3a-44f4-9b3c-9794ca9ddbc9` | 1,073.16 | 5,365.78 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `5771ec22-fb0e-4fd8-a73a-fdf451ab0741` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `7eb37770-9c35-460d-a896-910949ae0ea6` | 2.73 | 13.66 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `cf62a8e1-1f1e-40dc-bd90-1b5c84dfa9df` | 35.32 | 176.60 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `d0c7a7a5-72d2-4c09-a9f6-1b173c64d0a8` | 47.84 | 239.19 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s | `f8dd5b4f-3cf4-48e2-b453-7be4562e36cb` | — | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | k8s-andreas | `d03690cb-2ba4-4ff5-9519-27013515aba7` | 45.25 | 226.23 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SMO Railigent X | staging | `ae3e22a4-6e7a-487d-9c95-2c0fb3bb8f35` | 61.18 | 305.88 | classic API 400: cluster is read-only (not CAST-managed at cluster level) |
| SiePortal | rproxysbox100708blue | `028c4376-8af3-4674-bc4a-a5c3db1b3504` | 0.00 | — | classic API 400: cluster is read-only (not CAST-managed at cluster level) |

*These 22 clusters carry 1,265.50 billable vCPU (fee Σ $6,327.49 @5.00) with no classic savings figure — do not compare the classic Σ net against the VR Σ net without accounting for this exclusion (SMO Railigent X alone carries ~1,073 vCPU / $5.4k fee here while holding $158.7k of VR savings).*

## Notes

1. Classic ≠ VR basis: classic is capacity/mechanism metered (downscaling + spot), can back-fill savings before a cluster's real CAST onboarding, and has no demand cap. Use VR for leadership KPI; classic for mechanism/cash narrative.
2. Cluster classic_N/A rows: cluster is in a read-only onboarding state for the classic endpoint (e.g. externally-managed or woop-only). VR is the only savings basis available for them.
3. Savings split: downscaling $52,314 (87%) + spot $7,677 (13%) — downscaling-dominated, but spot is real at enterprise level (SI EA electrificationx, HAFAS H&O).
4. Fees applied USD per instruction; if contract is EUR, ×~1.15.

Provenance: enterprise/classic_<clusterID>.json (49 pulls, parallel xargs, 2026-10-12) + enterprise/result_slice{1..8}.tsv + billing_phase2_sep26_enterprise.json.
