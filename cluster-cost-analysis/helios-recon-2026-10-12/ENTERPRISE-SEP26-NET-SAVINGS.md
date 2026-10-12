# Siemens AG enterprise — CAST AI September 2026 net savings, all sub-organizations, all clusters

**Basis:** Value-Realization per-cluster report (`POST /reporting/v1beta/organizations/{org}/clusters:runValueRealizationReport` — note: the endpoint returns data **only when the `X-CastAI-Organization-Id` header matches the path org**), Sep window Europe/Berlin, discounted prices (console parity) · fees = enterprise billing `platform-usage-detail` (feature=phase2, aggregated at Siemens AG parent) × **$5.00** and × **$5.70** per billable vCPU · identification `cluster_id = name#aws_account_id#region`. All pulls 2026-10-12, `api.eu.cast.ai`. SI GSW CLO rows pinned to the console-verified pull presented earlier today.

**Σ ENTERPRISE: 130 orgs scanned · 57 orgs with clusters · 267 clusters inventoried · 62 VR-savings rows · actual Σ $242,492 · projected Σ $569,499 · gross savings Σ $327,007 · billable Σ 8,632.32 vCPU · fee Σ $43,161.62 @5.00 / $49,204.24 @5.70 · NET Σ **+$283,846** @5.00 / **+$277,803** @5.70.**

## Organization roll-up (orgs with savings or fees)

| Organization | Total clusters | w/ VR | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SMO Railigent X | 10 | 9 | 64,099 | 222,837 | 158,738 | 1,265.47 | 6,327.34 | 7,213.17 | **+152,411** | **+151,525** |
| SI GSW CLO | 22 | 8 | 86,578 | 185,196 | 98,618 | 3,531.32 | 17,656.58 | 20,128.50 | **+80,962** | **+78,490** |
| HAFAS H&O | 13 | 3 | 15,813 | 40,234 | 24,421 | 630.33 | 3,151.66 | 3,592.89 | **+21,270** | **+20,829** |
| SI B SW | 10 | 8 | 1,635 | 17,895 | 16,260 | 70.41 | 352.03 | 401.31 | **+15,908** | **+15,859** |
| CPS | 2 | 2 | 17,510 | 29,396 | 11,886 | 544.43 | 2,722.17 | 3,103.28 | **+9,164** | **+8,783** |
| IT IPS | 25 | 10 | 35,388 | 43,473 | 8,085 | 1,736.25 | 8,681.24 | 9,896.61 | **-596** | **-1,811** |
| SI EA electrificationx | 3 | 3 | 7,233 | 13,878 | 6,646 | 640.73 | 3,203.65 | 3,652.17 | **+3,442** | **+2,994** |
| Siemens Dev | 8 | 2 | 1,213 | 2,165 | 952 | 71.97 | 359.84 | 410.22 | **+592** | **+542** |
| SI-EP-EMS-R&D | 2 | 2 | 1,263 | 2,104 | 841 | 28.02 | 140.08 | 159.69 | **+701** | **+681** |
| FT FDS CES | 6 | 3 | 1,174 | 1,953 | 778 | 0.01 | 0.04 | 0.05 | **+778** | **+778** |
| evosoft IT MIS | 1 | 1 | 493 | 646 | 153 | 22.70 | 113.50 | 129.39 | **+40** | **+24** |
| CYS - CNAPP | 1 | 1 | 192 | 340 | 147 | 9.61 | 48.03 | 54.75 | **+99** | **+93** |
| FT-FT RPD CED SSI-IIP | 1 | 1 | 36 | 116 | 80 | 4.12 | 20.59 | 23.48 | **+59** | **+57** |
| SMO-SW-PDH-TPS | 2 | 1 | 67 | 117 | 50 | 4.24 | 21.21 | 24.17 | **+29** | **+26** |
| Pillar#1 | 9 | 6 | 8,303 | 8,303 | 0 | 5.02 | 25.12 | 28.64 | **-25** | **-29** |
| DI AUT PI APF | 1 | 1 | 650 | 596 | -54 | 26.42 | 132.12 | 150.62 | **-186** | **-204** |
| DI SW PRS AMER SLC | 2 | 1 | 847 | 250 | -597 | 41.28 | 206.40 | 235.30 | **-803** | **-832** |
| **Σ** | **118** | **62** | **242,492** | **569,499** | **327,007** | **8,632.32** | **43,161.62** | **49,204.24** | **+283,846** | **+277,803** |

## SMO Railigent X

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| k8s-andreas | k8s-andreas#484253082938#eu-central-1 | `d03690cb-2ba4-4ff5-9519-27013515aba7` | eu-central-1 | 754 | 159,492 | 158,738 | 45.25 | 226.23 | 257.91 | 158,512 | 158,480 |
| k8s | k8s#180820707530#ap-south-1 | `5771ec22-fb0e-4fd8-a73a-fdf451ab0741` | ap-south-1 | 561 | 561 | 0 | — | — | — | 0 | 0 |
| k8s | k8s#459423884365#eu-central-1 | `cf62a8e1-1f1e-40dc-bd90-1b5c84dfa9df` | eu-central-1 | 16,895 | 16,895 | 0 | 35.32 | 176.60 | 201.32 | -177 | -201 |
| k8s | k8s#676024189872#eu-central-1 | `0e277bb2-036d-485f-8690-4bf22720af9f` | eu-central-1 | 561 | 561 | 0 | — | — | — | 0 | 0 |
| k8s | k8s#251646500960#ap-south-1 | `7eb37770-9c35-460d-a896-910949ae0ea6` | ap-south-1 | 478 | 478 | 0 | 2.73 | 13.66 | 15.57 | -14 | -16 |
| k8s | k8s#353401772001#eu-central-1 | `f8dd5b4f-3cf4-48e2-b453-7be4562e36cb` | eu-central-1 | 544 | 544 | 0 | — | — | — | 0 | 0 |
| k8s | k8s#524840132901#eu-central-1 | `d0c7a7a5-72d2-4c09-a9f6-1b173c64d0a8` | eu-central-1 | 18,790 | 18,790 | 0 | 47.84 | 239.19 | 272.67 | -239 | -273 |
| k8s | k8s#978814483201#eu-central-1 | `4952c4ce-6a3a-44f4-9b3c-9794ca9ddbc9` | eu-central-1 | 24,290 | 24,290 | 0 | 1,073.16 | 5,365.78 | 6,116.99 | -5,366 | -6,117 |
| rhx-test | 35c0f9b5-25f1-49bb-aa2a-ec49915352b3 | `35c0f9b5-25f1-49bb-aa2a-ec49915352b3` | unknown | — | — | — | — | — | — | — | — |
| staging | staging#978814483201#eu-central-1 | `ae3e22a4-6e7a-487d-9c95-2c0fb3bb8f35` | eu-central-1 | 1,226 | 1,226 | 0 | 61.18 | 305.88 | 348.71 | -306 | -349 |
| **Σ SMO Railigent X** | | | | **64,099** | **222,837** | **158,738** | **1,265.47** | **6,327.35** | **7,213.17** | **+152,411** | **+151,525** |

## SI GSW CLO

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ngm-sim-eks | ngm-sim-eks#894875834901#eu-central-1 | `51dd234c-a5bf-4f99-a884-b79956de8f94` | eu-central-1 | 8,051 | 47,377 | 39,326 | 359.19 | 1,795.97 | 2,047.41 | 37,530 | 37,278 |
| baseline-clo-eks | baseline-clo-eks#110201440604#eu-central-1 | `02810f4b-b793-4ef2-95f1-e902af61d9e3` | eu-central-1 | 2,542 | 21,639 | 19,096 | 114.79 | 573.96 | 654.32 | 18,522 | 18,442 |
| alliander-demo-eks | alliander-demo-eks#721233634880#eu-central-1 | `c686f800-f17f-4b9a-8b7e-7655f209e07f` | eu-central-1 | 3,744 | 13,923 | 10,178 | — | — | — | 10,178 | 10,178 |
| ngm-sim2-eks | ngm-sim2-eks#894875834901#eu-central-1 | `8bd361b0-fcbf-491d-beac-af92fb7d6b46` | eu-central-1 | 2,047 | 11,625 | 9,578 | 67.22 | 336.08 | 383.13 | 9,242 | 9,195 |
| ngm-integ-eks | ngm-integ-eks#600442974479#eu-central-1 | `1ad1a0bf-defe-4f51-acea-cbebb3d3fc3f` | eu-central-1 | 22,031 | 30,739 | 8,708 | 1,049.92 | 5,249.58 | 5,984.52 | 3,458 | 2,723 |
| ngm-helios-eks | ngm-helios-eks#600442974479#eu-central-1 | `419c39e4-66bf-4d61-b833-4562968a61c7` | eu-central-1 | 45,121 | 51,790 | 6,668 | 1,850.51 | 9,252.56 | 10,547.91 | -2,584 | -3,880 |
| ngm-kronos-eks | ngm-kronos-eks#600442974479#eu-central-1 | `6d20eb8e-a1e5-4411-b4c8-5346ac3291b0` | eu-central-1 | 1,939 | 7,330 | 5,391 | 89.69 | 448.43 | 511.21 | 4,942 | 4,879 |
| clo-master-eks | clo-master-eks#115928806288#eu-central-1 | `9cabe4ee-c3cb-4877-a6e6-a464b3dd388a` | eu-central-1 | — | — | — | — | — | — | — | — |
| hermes-val-eks | hermes-val-eks#275315285795#eu-central-1 | `101ea9a6-02e5-45af-8ea0-6915a955c420` | eu-central-1 | — | — | — | — | — | — | — | — |
| iands-sales2-eks | iands-sales2-eks#547787420222#us-east-2 | `34e3e0bb-53d7-4b68-9e9d-17b0d79dfcf8` | us-east-2 | — | — | — | — | — | — | — | — |
| ngm-demo-eks | ngm-demo-eks#600442974479#eu-central-1 | `19336022-f195-4dda-b832-2b76d1a1c29c` | eu-central-1 | — | — | — | — | — | — | — | — |
| ngm-sim3-eks | ngm-sim3-eks#894875834901#eu-central-1 | `5efe373e-d2fe-43b1-a464-60ebcf16623a` | eu-central-1 | — | — | — | — | — | — | — | — |
| ngm-test-eks | ngm-test-eks#600442974479#eu-central-1 | `7290695f-e216-47df-ba5a-ca97ebb90045` | eu-central-1 | — | — | — | — | — | — | — | — |
| ngm-vsdev-eks | ngm-vsdev-eks#600442974479#eu-central-1 | `0ec063fc-f9ec-45e2-9d31-ea584a70f3bd` | eu-central-1 | — | — | — | — | — | — | — | — |
| ngm-vsinteg-eks | ngm-vsinteg-eks#600442974479#eu-central-1 | `bd3aaf10-963c-4c66-b6f1-d9ded41b4a4a` | eu-central-1 | — | — | — | — | — | — | — | — |
| onboard-delivery-eks | onboard-delivery-eks#547787420222#eu-central-1 | `71ad083b-adec-4379-9881-e4901cbf0a85` | eu-central-1 | — | — | — | — | — | — | — | — |
| onboard-sales1-eks | onboard-sales1-eks#547787420222#eu-central-1 | `1b97084a-82d3-45e1-b88f-db0c6f19191d` | eu-central-1 | — | — | — | — | — | — | — | — |
| shire-demo-eks | shire-demo-eks#843594798263#eu-central-1 | `6130ca25-a9aa-4bb4-98d2-402785f13317` | eu-central-1 | — | — | — | — | — | — | — | — |
| shire-dev-eks | shire-dev-eks#843594798263#eu-central-1 | `2a8cfae0-d269-4ccd-bdbd-0ee405f54d64` | eu-central-1 | — | — | — | — | — | — | — | — |
| shire-qa-eks | shire-qa-eks#843594798263#eu-central-1 | `c7498a9f-12f3-4153-ac33-540c0594ad48` | eu-central-1 | — | — | — | — | — | — | — | — |
| workbench-preprodeu-eks | workbench-preprodeu-eks#136730153639#eu-central-1 | `7eb74f76-a62c-482e-bb8a-14557d095d22` | eu-central-1 | — | — | — | — | — | — | — | — |
| ngm-data-eks | ngm-data-eks#595960695089#eu-south-1 | `9b9d2d51-ec75-46d4-bac0-ba38253cb8d9` | eu-south-1 | 1,103 | 776 | -327 | — | — | — | -327 | -327 |
| **Σ SI GSW CLO** | | | | **86,578** | **185,196** | **98,618** | **3,531.32** | **17,656.58** | **20,128.50** | **+80,962** | **+78,490** |

## HAFAS H&O

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| eks | eks#688967701480#eu-central-1 | `953f87e7-9175-435b-ad3b-1a3b8a4e7cad` | eu-central-1 | 12,020 | 32,853 | 20,833 | 446.25 | 2,231.24 | 2,543.61 | 18,602 | 18,290 |
| eks | eks#106391900725#eu-central-1 | `22bf2472-d9ba-4cb3-b6ec-1f7aab50cb3f` | eu-central-1 | 769 | 4,026 | 3,256 | 40.00 | 199.98 | 227.98 | 3,056 | 3,028 |
| eks | eks#933753214448#eu-central-1 | `8a9c0f55-86fc-4142-8f72-17ae6171a3aa` | eu-central-1 | 3,024 | 3,356 | 332 | 144.09 | 720.44 | 821.31 | -389 | -489 |
| argocd-demo | argocd-demo#132915311757#eu-central-1 | `b2dabc79-3aaa-4596-acd9-d3f17e3a222a` | eu-central-1 | — | — | — | — | — | — | — | — |
| eks-fat-euc1 | eks-fat-euc1#488305652903#eu-central-1 | `76246d36-88b0-41b7-bf98-0f6bbdde094a` | eu-central-1 | — | — | — | — | — | — | — | — |
| eks-prod-apse2 | eks-prod-apse2#488305652903#ap-southeast-2 | `aebceffe-11d4-4e34-973b-d9ad0c54c03b` | ap-southeast-2 | — | — | — | — | — | — | — | — |
| eks-prod-euc1 | eks-prod-euc1#488305652903#eu-central-1 | `90d11c07-a938-4dc4-ab73-c9288880b240` | eu-central-1 | — | — | — | — | — | — | — | — |
| eks-prod-use1 | eks-prod-use1#488305652903#us-east-1 | `fed60fe2-25bb-4a1f-9b1d-a19497a5d4c2` | us-east-1 | — | — | — | — | — | — | — | — |
| renfe-int | renfe-int#488305652903#eu-central-1 | `14c6bd24-75fd-46e5-98be-2b6e985edfb5` | eu-central-1 | — | — | — | — | — | — | — | — |
| renfe-prod | renfe-prod#488305652903#eu-central-1 | `553b905a-2334-4cb5-a059-ec58c616a8ae` | eu-central-1 | — | — | — | — | — | — | — | — |
| rivier | rivier#488305652903#eu-central-1 | `fcdc7184-a5a1-4b5d-a225-92e3fbfd8350` | eu-central-1 | — | — | — | — | — | — | — | — |
| sales-platform | sales-platform#488305652903#eu-central-1 | `9e18000c-a738-4745-8f8a-524c97a9376e` | eu-central-1 | — | — | — | — | — | — | — | — |
| timemachine | timemachine#488305652903#eu-central-1 | `7147d0b6-25e5-47b5-b193-a50c64a96291` | eu-central-1 | — | — | — | — | — | — | — | — |
| **Σ HAFAS H&O** | | | | **15,813** | **40,234** | **24,421** | **630.33** | **3,151.66** | **3,592.89** | **+21,270** | **+20,829** |

## SI B SW

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#972571274142#eu-west-1 | `dc10bd6a-1552-4c4b-9173-fc11b50c610f` | eu-west-1 | 407 | 12,150 | 11,743 | 29.17 | 145.85 | 166.27 | 11,597 | 11,577 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#018471890419#eu-west-1 | `01c18e7a-ce06-4c12-b921-c93e612d3bf0` | eu-west-1 | 239 | 2,467 | 2,228 | 11.34 | 56.71 | 64.65 | 2,171 | 2,163 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#380349240159#eu-west-1 | `6c94cd80-978f-4d9c-926e-df0e43dbb93f` | eu-west-1 | 172 | 1,179 | 1,007 | 6.38 | 31.90 | 36.36 | 975 | 971 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#877314709291#us-east-1 | `99cb56e0-50f9-4ad7-a803-d03da4d95513` | us-east-1 | 190 | 821 | 631 | 5.88 | 29.40 | 33.51 | 602 | 598 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#183098873491#eu-west-1 | `fd1ca573-4982-4133-89ce-bfd4df4f5d7b` | eu-west-1 | 172 | 514 | 342 | 8.27 | 41.34 | 47.13 | 301 | 295 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#290851856511#eu-west-1 | `6436c787-9169-4b3a-907c-d18776efeb19` | eu-west-1 | 195 | 503 | 309 | 9.37 | 46.84 | 53.40 | 262 | 255 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#023510080489#eu-west-1 | `1b0450f7-5532-4edd-af65-a754ff33ff40` | eu-west-1 | — | — | — | 0.00 | 0.00 | 0.00 | — | — |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#675913176182#eu-west-1 | `3782e6c8-4780-42cb-bada-97b096ee21f7` | eu-west-1 | 69 | 69 | 0 | — | — | — | 0 | 0 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#018471890419#us-east-1 | `dc42abdf-7485-4115-a23e-a623f63fc12f` | us-east-1 | 192 | 192 | 0 | — | — | — | 0 | 0 |
| fgeks-blue-eks-cluster | fgeks-blue-eks-cluster#380349240159#us-east-2 | `e3c91abe-69ae-4a79-b362-90f42e1917c0` | us-east-2 | — | — | — | 0.00 | 0.00 | 0.00 | — | — |
| **Σ SI B SW** | | | | **1,635** | **17,895** | **16,260** | **70.41** | **352.03** | **401.31** | **+15,908** | **+15,859** |

## CPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dema-platform-services | dema-platform-services#373270804851#eu-central-1 | `5dc3bf31-a263-4c6b-88bb-e95b6403aa51` | eu-central-1 | 17,045 | 28,730 | 11,685 | 527.54 | 2,637.72 | 3,007.01 | 9,047 | 8,678 |
| dema-platform-services-test | dema-platform-services-test#373270804851#eu-central-1 | `00ee8944-67f6-43d5-8517-c270951ec02c` | eu-central-1 | 465 | 666 | 202 | 16.89 | 84.45 | 96.27 | 117 | 105 |
| **Σ CPS** | | | | **17,510** | **29,396** | **11,886** | **544.43** | **2,722.17** | **3,103.28** | **+9,164** | **+8,783** |

## IT IPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pioneer-tcx | pioneer-tcx#136905788720#eu-central-1 | `a4ee9bce-da9e-4cae-8eda-caeb0b5ab20a` | eu-central-1 | 663 | 3,629 | 2,966 | 24.56 | 122.81 | 140.00 | 2,843 | 2,826 |
| aks-dios-weu-prod-001 | b5d4cd12-98b2-4e9f-90a1-4db0134337c4 | `b5d4cd12-98b2-4e9f-90a1-4db0134337c4` | westeurope | 2,593 | 5,286 | 2,694 | 50.34 | 251.69 | 286.93 | 2,442 | 2,407 |
| aks-dios-weu-test-001 | b01c58a4-4ad2-4756-b729-e0cf07b8fba6 | `b01c58a4-4ad2-4756-b729-e0cf07b8fba6` | westeurope | 1,221 | 2,992 | 1,770 | 28.01 | 140.06 | 159.67 | 1,630 | 1,611 |
| eagle-kafka01 | eagle-kafka01#897825492946#eu-central-1 | `ef65cdd5-853a-46d3-9694-6d93edd6ad2d` | eu-central-1 | 1,143 | 2,726 | 1,584 | 47.53 | 237.65 | 270.92 | 1,346 | 1,313 |
| eleX01 | eleX01#576061914293#eu-central-1 | `f0fa2ea7-48db-4473-b6b3-c73123fa0dac` | eu-central-1 | 6,462 | 7,710 | 1,248 | 332.68 | 1,663.42 | 1,896.30 | -415 | -648 |
| eleX01 | eleX01#546544527727#us-east-2 | `7b646d74-cc78-4703-a14f-865b3c0451bf` | us-east-2 | 5,589 | 6,670 | 1,080 | 327.00 | 1,635.02 | 1,863.92 | -555 | -784 |
| eleX01in | eleX01in#637423451488#ap-south-1 | `cf027570-8275-4d1d-a2e1-f9ffbb713f9e` | ap-south-1 | 3,301 | 3,935 | 634 | 336.34 | 1,681.71 | 1,917.15 | -1,047 | -1,283 |
| aks-n8n-weu-prod-001 | 285a5dae-36f4-4fa3-9e42-27948f0c06dd | `285a5dae-36f4-4fa3-9e42-27948f0c06dd` | westeurope | — | — | — | — | — | — | — | — |
| aks-n8n-weu-test-001 | 78deb4c6-46e8-4512-8a1e-92d9416cb34f | `78deb4c6-46e8-4512-8a1e-92d9416cb34f` | westeurope | — | — | — | — | — | — | — | — |
| aks-neobot-weu-prod-001 | c66abc3b-7ffb-4576-b65e-9fa96ef14147 | `c66abc3b-7ffb-4576-b65e-9fa96ef14147` | westeurope | — | — | — | — | — | — | — | — |
| aks-neobot-weu-test-001 | 43d2436d-2f2d-44cb-99f5-6ed799511dac | `43d2436d-2f2d-44cb-99f5-6ed799511dac` | westeurope | — | — | — | — | — | — | — | — |
| bx-edex-dev-eu | bx-edex-dev-eu#287526491081#eu-west-1 | `4f9d90bf-10e7-4bd8-8b18-a094484eaf68` | eu-west-1 | — | — | — | — | — | — | — | — |
| bx-edex-int-eu | bx-edex-int-eu#713881807618#eu-west-1 | `bc30a320-2cc9-4fa1-8423-67cb45fb4776` | eu-west-1 | — | — | — | — | — | — | — | — |
| bx-edex-prod-eu | bx-edex-prod-eu#577638380263#eu-west-1 | `ce86ecf0-1c17-4d02-936b-dd239411ea0a` | eu-west-1 | — | — | — | — | — | — | — | — |
| cloudcore01 | cloudcore01#040286887818#eu-central-1 | `e16fc060-803a-47e2-985e-f0c15058a6c9` | eu-central-1 | — | — | — | — | — | — | — | — |
| cloudcore02 | cloudcore02#043203988634#eu-central-1 | `56d5ca2d-a5b7-4223-97f2-75f2af35b242` | eu-central-1 | — | — | — | — | — | — | — | — |
| dev-sec | dev-sec#195384726758#eu-west-1 | `6bb5a236-875d-4158-9c5c-a1d66e08ac83` | eu-west-1 | — | — | — | — | — | — | — | — |
| ea-admin-management-cluster | 51b3e19e-eb6d-421c-b8dc-6587aae498ba | `51b3e19e-eb6d-421c-b8dc-6587aae498ba` | westeurope | — | — | — | — | — | — | — | — |
| mof | mof#188289743005#us-east-2 | `66723d08-943f-4b85-9f75-80d9bd5c4511` | us-east-2 | — | — | — | — | — | — | — | — |
| mof-staging | mof-staging#493565080783#us-east-2 | `4aaa7671-3d83-454d-a7aa-449df17c10d3` | us-east-2 | — | — | — | — | — | — | — | — |
| shared01 | shared01#474569730283#eu-central-1 | `cd7be1fb-81c3-4c01-8d22-efe977e629bd` | eu-central-1 | — | — | — | — | — | — | — | — |
| staging-sec | staging-sec#500412134877#eu-west-1 | `83ce9be7-78b8-4d5c-a49c-4e1584f93251` | eu-west-1 | — | — | — | — | — | — | — | — |
| kafka-test | kafka-test#187494036103#eu-central-1 | `06a44e72-8f49-4f6f-a2f5-2092d14cffe4` | eu-central-1 | 398 | 191 | -207 | 16.51 | 82.53 | 94.08 | -290 | -301 |
| iec-tcx-flat | iec-tcx-flat#987708558949#eu-central-1 | `c783a2f5-d6c9-4c93-9bbe-216d2c614903` | eu-central-1 | 1,106 | 687 | -419 | 33.04 | 165.21 | 188.34 | -584 | -608 |
| eleX01p | eleX01p#976594908632#eu-central-1 | `823f9475-109e-4a8a-bed1-c1fba8441882` | eu-central-1 | 12,912 | 9,647 | -3,265 | 540.23 | 2,701.13 | 3,079.29 | -5,966 | -6,345 |
| **Σ IT IPS** | | | | **35,388** | **43,473** | **8,085** | **1,736.25** | **8,681.24** | **9,896.61** | **-596** | **-1,811** |

## SI EA electrificationx

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| eks-Cluster1 | eks-Cluster1#955761008245#eu-central-1 | `c6cdf969-f81c-4324-a498-89008dce1351` | eu-central-1 | 4,068 | 7,865 | 3,797 | 369.75 | 1,848.76 | 2,107.59 | 1,948 | 1,690 |
| eks-Cluster1 | eks-Cluster1#129753847697#eu-central-1 | `f31e9de1-7884-470e-95ce-11c9f5dcfe0d` | eu-central-1 | 2,978 | 5,835 | 2,857 | 264.67 | 1,323.34 | 1,508.60 | 1,534 | 1,349 |
| eks-Cluster1 | eks-Cluster1#955761008245#eu-north-1 | `1ca6667a-06af-497f-a7ae-b9e7748c9493` | eu-north-1 | 187 | 179 | -9 | 6.31 | 31.56 | 35.97 | -40 | -45 |
| **Σ SI EA electrificationx** | | | | **7,233** | **13,878** | **6,646** | **640.73** | **3,203.65** | **3,652.17** | **+3,442** | **+2,994** |

## Siemens Dev

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| pfm-eks-cluster | pfm-eks-cluster#955761008245#eu-west-1 | `de02aae4-1fd1-401a-ad47-345711d4d7b3` | eu-west-1 | 906 | 1,670 | 764 | 71.97 | 359.84 | 410.22 | 404 | 354 |
| dev-vlab-cluster | dev-vlab-cluster#488218212374#eu-central-1 | `0528411e-4d89-4fcf-af04-1b496541025d` | eu-central-1 | 307 | 495 | 188 | — | — | — | 188 | 188 |
| aks-castai-demo | d1bf9c35-07ac-4c4b-9d7a-ac41473c3b10 | `d1bf9c35-07ac-4c4b-9d7a-ac41473c3b10` | westeurope | — | — | — | — | — | — | — | — |
| dev | dev#153524503100#us-west-2 | `4dee25ab-9f1c-494f-bef0-b7190dddb3eb` | us-west-2 | — | — | — | — | — | — | — | — |
| dev-vlab-cluster | dev-vlab-cluster#488218212374#ap-southeast-1 | `172021b8-c68a-4ddb-9658-01e4c44a561e` | ap-southeast-1 | — | — | — | — | — | — | — | — |
| dev-vlab-cluster | dev-vlab-cluster#488218212374#us-west-2 | `83d2c65c-e0d7-46db-8bb8-bf5f0d368754` | us-west-2 | — | — | — | — | — | — | — | — |
| shared-services-us-east-1-eks | shared-services-us-east-1-eks#354567316383#us-east-1 | `91649234-53f9-44b1-a883-5eae8fe0afbe` | us-east-1 | — | — | — | — | — | — | — | — |
| sp-tofu-simple | sp-tofu-simple#027851298014#eu-central-1 | `dac52e3e-1576-479c-b61e-f33589de026f` | eu-central-1 | — | — | — | 0.00 | 0.00 | 0.00 | — | — |
| **Σ Siemens Dev** | | | | **1,213** | **2,165** | **952** | **71.97** | **359.84** | **410.22** | **+592** | **+542** |

## SI-EP-EMS-R&D

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cluster | cluster#480007738569#eu-west-1 | `95276912-9b38-42d6-91d5-a388fc0280d2` | eu-west-1 | 474 | 1,014 | 540 | 18.58 | 92.91 | 105.91 | 447 | 434 |
| cluster | cluster#471112794282#eu-central-1 | `67a9bd91-0edf-40f9-8429-e14f3707a750` | eu-central-1 | 789 | 1,089 | 301 | 9.43 | 47.17 | 53.78 | 254 | 247 |
| **Σ SI-EP-EMS-R&D** | | | | **1,263** | **2,104** | **841** | **28.02** | **140.08** | **159.69** | **+701** | **+681** |

## FT FDS CES

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| iemc-cluster-int | iemc-cluster-int#104217848981#eu-central-1 | `25c0a174-d4b6-48d7-9459-f3240f97a1a8` | eu-central-1 | 465 | 885 | 420 | — | — | — | 420 | 420 |
| iemc-cluster-dev | iemc-cluster-dev#251950426335#eu-central-1 | `dd0b548e-f6e0-4b50-b14c-13b2cc26ba48` | eu-central-1 | 575 | 925 | 350 | 0.01 | 0.04 | 0.05 | 350 | 350 |
| iemc-cluster-ipcei-test | iemc-cluster-ipcei-test#010928208160#eu-central-1 | `6f77cf09-c22b-46ba-8e41-3ea270f65c26` | eu-central-1 | 134 | 142 | 8 | — | — | — | 8 | 8 |
| iemc-cluster-alpha | iemc-cluster-alpha#464383546700#eu-central-1 | `59ac1d97-4402-4d34-8220-e4b708484f28` | eu-central-1 | — | — | — | — | — | — | — | — |
| iemc-cluster-ipcei | iemc-cluster-ipcei#010928208160#eu-central-1 | `198cb29e-083a-4a28-bfda-ba1c1b997c08` | eu-central-1 | — | — | — | — | — | — | — | — |
| iemc-cluster-prod | iemc-cluster-prod#464383546700#eu-central-1 | `6d05a5b0-a4e1-4761-a19c-806c0069042c` | eu-central-1 | — | — | — | — | — | — | — | — |
| **Σ FT FDS CES** | | | | **1,174** | **1,953** | **778** | **0.01** | **0.04** | **0.05** | **+778** | **+778** |

## evosoft IT MIS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ITMIS | ITMIS#864981718205#eu-central-1 | `31864129-b09c-47b2-a8df-c616f98d65b7` | eu-central-1 | 493 | 646 | 153 | 22.70 | 113.50 | 129.39 | 40 | 24 |
| **Σ evosoft IT MIS** | | | | **493** | **646** | **153** | **22.70** | **113.50** | **129.39** | **+40** | **+24** |

## CYS - CNAPP

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| wiz-outpost-lite | wiz-outpost-lite#890988596583#eu-central-1 | `95bf32c8-ced4-4a81-9665-f3c6278f5f57` | eu-central-1 | 192 | 340 | 147 | 9.61 | 48.03 | 54.75 | 99 | 93 |
| **Σ CYS - CNAPP** | | | | **192** | **340** | **147** | **9.61** | **48.03** | **54.75** | **+99** | **+93** |

## FT-FT RPD CED SSI-IIP

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| CDM-EKS-Cluster | CDM-EKS-Cluster#904494280429#eu-central-1 | `62aa894c-1d41-4a7a-98ed-e181e289e173` | eu-central-1 | 36 | 116 | 80 | 4.12 | 20.59 | 23.48 | 59 | 57 |
| **Σ FT-FT RPD CED SSI-IIP** | | | | **36** | **116** | **80** | **4.12** | **20.59** | **23.48** | **+59** | **+57** |

## SMO-SW-PDH-TPS

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| eks-tpslive-dev | eks-tpslive-dev#522814722959#eu-central-1 | `d119d612-84ad-4c79-9992-a120b7206f15` | eu-central-1 | 67 | 117 | 50 | 4.24 | 21.21 | 24.17 | 29 | 26 |
| tps-eks-cluster-master | tps-eks-cluster-master#730335428681#eu-central-1 | `2ec5dafa-7a81-44fe-b42f-16d4d9f4b76d` | eu-central-1 | — | — | — | — | — | — | — | — |
| **Σ SMO-SW-PDH-TPS** | | | | **67** | **117** | **50** | **4.24** | **21.21** | **24.17** | **+29** | **+26** |

## Pillar#1

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| console-eks-integ | console-eks-integ#238720913587#us-east-1 | `d909c528-e5d0-4ebd-8c1a-77ad9b76a54b` | us-east-1 | 2,995 | 2,995 | 0 | 5.02 | 25.12 | 28.64 | -25 | -29 |
| console-eks-preprod | console-eks-preprod#477662162423#eu-central-1 | `a8129ccd-1dd4-441c-aaee-babd56ea5dc3` | eu-central-1 | 2,547 | 2,547 | 0 | — | — | — | 0 | 0 |
| fds-sdk-testing | fds-sdk-testing#238720913587#us-east-1 | `802629ad-ca96-4ee5-aa19-a253788f96d3` | us-east-1 | — | — | — | — | — | — | — | — |
| fgac-eks-integ | fgac-eks-integ#238720913587#us-east-1 | `b97e51e0-b4d7-42b3-a50a-ad29b9ab6b4d` | us-east-1 | 819 | 819 | 0 | — | — | — | 0 | 0 |
| fgac-eks-preprod | fgac-eks-preprod#477662162423#eu-central-1 | `cce8c41d-bf31-4c7e-bfff-dd2f8f0cd519` | eu-central-1 | 728 | 728 | 0 | — | — | — | 0 | 0 |
| gw-eks-integ | gw-eks-integ#238720913587#us-east-1 | `514bf38c-5235-44b6-a951-8e69528b5943` | us-east-1 | 381 | 381 | 0 | — | — | — | 0 | 0 |
| gw-eks-preprod | gw-eks-preprod#477662162423#eu-central-1 | `c086341f-ab62-4abc-90c8-a9ace1b45426` | eu-central-1 | 833 | 833 | 0 | — | — | — | 0 | 0 |
| nfr-eks-integ-3 | nfr-eks-integ-3#238720913587#eu-central-1 | `7743765a-2915-4699-97cd-06bb897acc09` | eu-central-1 | — | — | — | — | — | — | — | — |
| nfr-eks-preprod | nfr-eks-preprod#477662162423#eu-central-1 | `04f26ee9-6fe7-4467-a222-061cee09011f` | eu-central-1 | — | — | — | — | — | — | — | — |
| **Σ Pillar#1** | | | | **8,303** | **8,303** | **0** | **5.02** | **25.12** | **28.64** | **-25** | **-29** |

## DI AUT PI APF

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dev-cluster | dev-cluster#660922352913#eu-central-1 | `7e04bd70-0513-4c6b-8b38-42b6c46905d9` | eu-central-1 | 650 | 596 | -54 | 26.42 | 132.12 | 150.62 | -186 | -204 |
| **Σ DI AUT PI APF** | | | | **650** | **596** | **-54** | **26.42** | **132.12** | **150.62** | **-186** | **-204** |

## DI SW PRS AMER SLC

| Cluster name | Cluster ID (name#account#region) | CAST AI cluster ID | Region | Actual $ | Projected $ | Gross savings $ | Billable vCPU | Fee $ @5.00 | Fee $ @5.70 | **Net $ @5.00** | **Net $ @5.70** |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| SLC-SS | SLC-SS#483428953713#us-east-1 | `96b41307-2647-44ad-9185-da143f346928` | us-east-1 | — | — | — | — | — | — | — | — |
| Posit | Posit#483428953713#us-east-1 | `893e4362-bb07-417a-b53c-f9b011b4240d` | us-east-1 | 847 | 250 | -597 | 41.28 | 206.40 | 235.30 | -803 | -832 |
| **Σ DI SW PRS AMER SLC** | | | | **847** | **250** | **-597** | **41.28** | **206.40** | **235.30** | **-803** | **-832** |

## Inventory-only orgs (no September savings, no CAST AI fee)

- **APM0000770 - DUVE Web** — 2 cluster(s), all unmanaged/undriven in Sep: aks-duve-nonprod-01, aks-duve-prod-01
- **APM0002714 - GSP Kafka** — 2 cluster(s), all unmanaged/undriven in Sep: gspkafka-k8s-dev, gspkafka-k8s-prod
- **APM0006869 - PKN - Product Knowledge Network** — 2 cluster(s), all unmanaged/undriven in Sep: pkn-nonprod-eks-1985, pkn-prod-eks-1985
- **APM0022732 - PCIS - Product Class Infostructure** — 2 cluster(s), all unmanaged/undriven in Sep: pcis-nonprod-eks-9841, pcis-prod-eks-9841
- **APM0029033 - CIC API Management - KONG** — 2 cluster(s), all unmanaged/undriven in Sep: case-k8s-private-dev-1, case-k8s-private-prod-fargate
- **APM0271596 - PSE Consulting** — 1 cluster(s), all unmanaged/undriven in Sep: pse-consulting-eks-shared
- **APM0414470 - SiBase X** — 4 cluster(s), all unmanaged/undriven in Sep: eks-cluster, eks-cluster, eks-cluster, eks-cluster
- **APM0423755 - Azure Platform Service** — 1 cluster(s), all unmanaged/undriven in Sep: rg-lab-aks-nodes-prod
- **Botanica** — 2 cluster(s), all unmanaged/undriven in Sep: kubernetes, kubernetes
- **CASE** — 1 cluster(s), all unmanaged/undriven in Sep: shining-star
- **DAI R SDE** — 3 cluster(s), all unmanaged/undriven in Sep: ipae-climatix, ipae-dtac-sandbox, ipae-sandbox-audi
- **DAI-R-SMR** — 1 cluster(s), all unmanaged/undriven in Sep: data-vault
- **DDI SW MNDX PRO&TECH** — 12 cluster(s), all unmanaged/undriven in Sep: central-accp, central-test, gp-us-1-test, internal-dev, nonprod-2-eks, nonprod-4-eks, nonprod-5-eks, pipeline-accp, pipeline-test, public-cloud-cd-nonprod, synthia-test-2, ucp-cd-nonprod
- **DI FA DSP - DPP** — 7 cluster(s), all unmanaged/undriven in Sep: bp-blo-260, bp-blo-359, bp-blo-379t, bp-blo-408, bp-blo-417, bp-blo-422, bp-dev
- **DI FA HMI URT PRC2** — 1 cluster(s), all unmanaged/undriven in Sep: iowa-tools-cluster
- **DI IT DEX CLD** — 1 cluster(s), all unmanaged/undriven in Sep: gspkafka-k8s-dev
- **DI SW PLM DM DDM** — 3 cluster(s), all unmanaged/undriven in Sep: ih-dev, ihubinteg-aks, ops-common-integ
- **DI-SW-RAPIDMINER-GRAPH** — 1 cluster(s), all unmanaged/undriven in Sep: graph-dev-qa-eks
- **DISW-SERVICES-LM** — 1 cluster(s), all unmanaged/undriven in Sep: teamcenter
- **FT FDS CDS** — 2 cluster(s), all unmanaged/undriven in Sep: cds-integ, cds-integ-us
- **FT-RDP-SSP-DEVOPSFF-EKS-DEV** — 1 cluster(s), all unmanaged/undriven in Sep: eks-dev
- **IT DA** — 1 cluster(s), all unmanaged/undriven in Sep: knime-test
- **IT DA PL IP - SDC.Streaming** — 3 cluster(s), all unmanaged/undriven in Sep: sdcstreaming-eks-cluster-dev, sdcstreaming-eks-cluster-prod, sdcstreaming-eks-cluster-qa
- **IT DF COL UC 2** — 1 cluster(s), all unmanaged/undriven in Sep: siemenstest-siemenstest-1
- **IT-APS-DEV-ACO** — 2 cluster(s), all unmanaged/undriven in Sep: grafana-poc, n8n
- **LCB-IT** — 1 cluster(s), all unmanaged/undriven in Sep: aks-bricks-prod
- **Pillar#2** — 1 cluster(s), all unmanaged/undriven in Sep: console-eks-integ
- **RC-IT DI S TSP ARCH** — 1 cluster(s), all unmanaged/undriven in Sep: eks-iem-ita
- **SFS IT CDO** — 16 cluster(s), all unmanaged/undriven in Sep: rg-api-p-base-aks-internal, rg-api-t-base-aks-internal, rg-app-d-base-aks-internal, rg-app-p-base-aks-internal, rg-app-t-base-aks-internal, rg-cdb-d-base-aks-internal, rg-cdb-p-base-aks-internal, rg-cdb-t-base-aks-internal, rg-cdo-d-base-aks-internal, rg-cdo-p-base-aks-internal, rg-sca-d-base-aks-internal, rg-sca-p-base-aks-internal, rg-sca-t-base-aks-internal, rg-ssm-d-base-aks-internal, rg-ssm-p-base-aks-internal, rg-ssm-t-base-aks-internal
- **SI B SER DSC TEI CLO** — 1 cluster(s), all unmanaged/undriven in Sep: sdlc
- **SI-B-BTWIN** — 1 cluster(s), all unmanaged/undriven in Sep: fgeks-blue-eks-cluster
- **SI-SI EP EMS FIN IT CSS-CTDM** — 1 cluster(s), all unmanaged/undriven in Sep: CDM-EKS-Cluster
- **SMO CS DS EAM - CORMAP** — 1 cluster(s), all unmanaged/undriven in Sep: cormap-utilities-eks
- **SMO NEE RC-CH RI ADC 4 3** — 1 cluster(s), all unmanaged/undriven in Sep: trackops-new
- **SMO-RI-CSX-CS** — 34 cluster(s), all unmanaged/undriven in Sep: csx-amparo-test, csx-anitha-test, csx-ashik-devops, csx-ashish-devops, csx-carlos-test, csx-chaitanya-test, csx-demo, csx-dev-chessie, csx-dev-yardbirds, csx-eva-test, csx-georgi-vnv, csx-jenny-test, csx-mathias-test, csx-mike-test, csx-parisa-test, csx-patrick-test, csx-performance-test, csx-pradeep-test, csx-production-replica, csx-raghu-test, csx-simulator-test, csx-snigdha-devops, csx-spain-1-test, csx-spain-2-test, csx-spain-3-sim-test, csx-spain-4-sim-test, csx-spain-5-test, csx-sreerag-test, csx-sunil-test, csx-yogesh-test, gitlab-runner-cs-services, gitlab-runner-eks, sunil-2-tst, ui-automation
- **SMO-RS-EEC-EN-CCI-DE-CD-Kodex** — 1 cluster(s), all unmanaged/undriven in Sep: eks-tools
- **SMO-SW-MAAS-HACON-TEC-OBS-ANALTICS** — 1 cluster(s), all unmanaged/undriven in Sep: cnpg-poc-cluster
- **SPICE** — 1 cluster(s), all unmanaged/undriven in Sep: spice-100794-sbox-tooling-01
- **SiePortal** — 28 cluster(s), all unmanaged/undriven in Sep: mallprod-euwe1-100195-01-blue-mc, mallprod-euwe1-100195-01-green-mc, mallqa-euwe1-100195-01-blue-mc, mallqa-euwe1-100195-01-green-mc, mallsbox100195blue, mallsbox100195green, rproxyprod-euwe1-100708-01-blue-mc, rproxyprod-euwe1-100708-01-green-mc, rproxyqa-euwe1-100708-01-blue-mc, rproxyqa-euwe1-100708-01-green-mc, rproxysbox100708blue, rproxysbox100708green, sieportalprod-euwe1-100188-01-blue-mc, sieportalprod-euwe1-100188-01-green-mc, sieportalqa-euwe1-100188-01-blue-mc, sieportalqa-euwe1-100188-01-green-mc, sieportalsbox100188blue, sieportalsbox100188green, siosprod-euwe1-100320-01-blue-mc, siosprod-euwe1-100320-01-green-mc, siosqa-euwe1-100320-01-blue-mc, siosqa-euwe1-100320-01-green-mc, toolingprod-euwe1-100786-01-blue-mc, toolingprod-euwe1-100786-01-green-mc, toolingqa-euwe1-100786-01-blue-mc, toolingqa-euwe1-100786-01-green-mc, toolingsbox100786blue, toolingsbox100786green
- **TeamLeonis** — 1 cluster(s), all unmanaged/undriven in Sep: pssp-k8s-cluster

## Notes

1. **Clubs with negative or thin net get flagged per row (see tables).** Headline positives: SMO Railigent X, SI GSW CLO, HAFAS H&O, SI B SW, CPS. Inspect: IT IPS (net −$596/−$1,811 — heavy eleX01 fee base vs thin September savings), DI SW PRS AMER SLC (−$803/−$832 — negative VR on Posit + fee), DI AUT PI APF (−$186/−$204), Pillar#1 (VR 0 across 6 rows — inside baseline window → fee-only −$25/−$29).
2. `has_vr=no` rows were legitimately absent from the September VR window (not an API artifact — verified by re-pulling all 21 billed orgs with the required org header; 16 orgs returned data, 4 others are consistent zeros with ~0 billing: SiePortal, CASE, FT-RDP-SSP-DEVOPSFF-EKS-DEV, DI IT DEX CLD).
3. Fees applied in USD per instruction; if contract quotes EUR, multiply by EUR→USD FX (≈1.15).
4. One orphan billed cluster (0.022 vCPU, no inventory row — likely deleted mid-month) excluded from roster; negligible ($0.11).
5. fmt: net cells equal gross savings for rows with no billing entity (fee = —).
6. Provenance: `enterprise/result_slice{1..8}.tsv` (8 parallel org sweeps), `enterprise/vr_<org_id>.json` (21 verified pulls), `billing_phase2_sep26_enterprise.json` (parent-aggregated), `vr_sep26_berlin_all_clusters.json` (GSW CLO verified), CSV `vr_sep26_enterprise_net_savings.csv`.
