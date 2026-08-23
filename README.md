### AI REVENUE RECOVERY (REVRECOVER)
# System Architecture

```mermaid
flowchart TD
    %% Ingress & Edge
    Client([Customer / Checkout UI]) -->|1. Payment Request| RZP[Razorpay Gateway]
    RZP -.->|2. payment.failed / captured| Webhook[Webhook Ingress / Express API]

    %% Idempotency Layer
    subgraph Ingress_Layer [Edge & Security Layer]
        Webhook -->|HMAC-SHA256 Sig Check| SigGuard{Valid Sig?}
        SigGuard -- No --> AuthReject[401 Unauthorized]
        SigGuard -- Yes --> RedisLock[Redis Distributed Lock - SETNX payment_id EX 120s]
        RedisLock -->|Lock Acquired| Fast200[Immediate 200 OK Ack - p50: 5.13ms]
        RedisLock -- Duplicate Key --> DropDup[Drop Duplicate / Suppress]
    end

    %% Triage Matrix
    subgraph Triage_Engine [Deterministic Triage Matrix]
        Fast200 --> Triage[Triage Engine - Inspect step, source, code]
        Triage --> RouteA_Branch{Transient 5XX / Bank Drop?}
        Triage --> RouteB_Branch{Soft Customer Drop?}
        Triage --> RouteC_Branch{Terminal Hard Failure?}
    end

    %% Queues & Workers
    subgraph Execution_Layer [Asynchronous BullMQ & Worker Plane]
        RouteA_Branch -- Yes --> RouteAQueue[(BullMQ: Route A Queue)]
        RouteB_Branch -- Yes --> RouteBQueue[(BullMQ: Route B Queue)]
        RouteC_Branch -- Yes --> DLQ[(Terminal Exception DLQ)]

        %% Route A Execution
        RouteAQueue --> WorkerA[Route A Worker - 1m to 5m Backoff]
        WorkerA --> InquestCheckA{verifyLateAuth - Status == captured?}
        InquestCheckA -- Yes --> ReconcileA[Mark RECOVERED]
        InquestCheckA -- No --> RetryPayment[Execute Idempotent Retry]

        %% Route B Execution
        RouteBQueue --> WorkerB[Route B Worker - Agentic Dunning]
        WorkerB --> InquestCheckB{verifyLateAuth?}
        InquestCheckB -- Yes --> SuppressB[Suppress Nudge & Reconcile]
        InquestCheckB -- No --> GenAI[Gemini Engine - Prompt + Fallback Cache]
        GenAI --> WhatsApp[Meta WhatsApp Cloud API - 1-Click UPI Intent Link]

        %% B2B Flow
        WhatsApp -.-> CustomerReply[Customer WhatsApp Reply]
        CustomerReply --> PTPParser[Gemini PTP Date Parser]
        PTPParser --> InvoiceLock[Lock PTP Date on Invoice]
    end

    %% Storage & Telemetry
    subgraph Data_Layer [Data & Telemetry Layer]
        ReconcileA --> Atlas[(MongoDB Atlas Cluster)]
        SuppressB --> Atlas
        DLQ --> Atlas
        InvoiceLock --> Atlas
        Atlas --> MetricsAPI[Telemetry & AOR Aggregations]
    end

    %% Circuit Breaker
    subgraph Resilience [Real-Time Resilience Engine]
        RZP -.-> FailureFeed[Failure Feed]
        FailureFeed --> CircBreaker[38s Sliding Window ZSET]
        CircBreaker -->|Failures >= 5| Trip[Trip Rail Status: DEGRADED]
        Trip --> FallbackRail[Reroute Traffic to UPI Rails]
    end

    classDef primary fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef highlight fill:#0f766e,stroke:#2dd4bf,stroke-width:2px,color:#fff;
    classDef alert fill:#881337,stroke:#f43f5e,stroke-width:2px,color:#fff;

    class Ingress_Layer primary;
    class Triage_Engine primary;
    class Execution_Layer primary;
    class Data_Layer primary;
    class Resilience primary;
    
    class Fast200 highlight;
    class ReconcileA highlight;
    class SuppressB highlight;
    
    class DLQ alert;
    class AuthReject alert;
```
