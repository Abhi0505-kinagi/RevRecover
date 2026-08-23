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

### Problems Solved:
### A user attempts a checkout. Their issuing bank deducts the money from their bank account, but a network timeout occurs right before the bank's confirmation response reaches Razorpay. Razorpay fires a payment.failed webhook. Traditional systems blindly retry the charge (causing a double debit) or send angry support tickets.
<img width="760" height="540" alt="lateauthorization drawio (1)" src="https://github.com/user-attachments/assets/32990176-cc22-482d-bcde-2cf8ec21f7c0" />

### A user encounters an "Insufficient Funds" error or accidentally closes their UPI PIN entry modal. Standard systems send un-personalized email notifications that go unopened, or repeatedly hit the same failing card.
Solution:
<img width="842" height="657" alt="Screenshot 2026-08-23 202230" src="https://github.com/user-attachments/assets/4c98bbd7-825e-45a5-ba54-b4a80ca6f40f" />

### A customer’s card is expired or flagged for fraud. If a gateway aggressively retries this transaction, the merchant incurs card network penalty fees and risks compliance penalties.
Solution: 
<img width="746" height="586" alt="cardexpiryorfraud drawio" src="https://github.com/user-attachments/assets/e4f52e82-67c8-4b0b-a94d-848857cb081b" />
### B2B invoices become overdue. Traditional follow-ups involve manual emails that get ignored, leaving merchants with cash flow gaps and no structured legal track.
Solution:
<img width="891" height="564" alt="b2brecovery drawio" src="https://github.com/user-attachments/assets/218e5f59-698d-41c3-b7ed-c8b06a0711a7" />


# Environment Variables
```
PORT=port
NODE_ENV=mode
REDIS_HOST=your_host
REDIS_PORT=redis port
REDIS_PASSWORD=your_reidis password
MONGO_URI= your_mognoDBURL
BENCHMARK_MODE=false
SMTP_HOST=smpt service
SMTP_PORT=smtp_port
SMTP_USER=uer_smpt_user
SMTP_PASS=smtp_pass
RAZORPAY_KEY_ID=rzp_test_YourKeyIdHere
RAZORPAY_KEY_SECRET=YourKeySecretHere
RAZORPAY_WEBHOOK_SECRET=YourWebhookSecretHere
GEMINI_API_KEY=your_gemini_api_key
META_WHATSAPP_TOKEN=mock
META_PHONE_NUMBER_ID=mock
```


