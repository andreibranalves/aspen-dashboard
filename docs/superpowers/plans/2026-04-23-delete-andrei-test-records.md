# Delete Andrei Test Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all test records associated with "Andrei" from the Frappe instance to resolve naming collisions.

**Architecture:** Use a Node.js script to sequentially delete records via the Frappe REST API, respecting referential integrity by deleting child/dependent records first.

**Tech Stack:** Node.js, Frappe REST API

---

### Task 1: Create Deletion Script

**Files:**
- Create: `scripts/delete_test_records.mjs`

- [x] **Step 1: Write the deletion script**

```javascript
import fs from 'fs';
import https from 'https';

const envPath = './.env';
const env = fs.readFileSync(envPath, 'utf8');
const token = env.split('\n').find(line => line.startsWith('ERPNEXT_TOKEN=')).split('=')[1].trim();
const instance = 'https://aspenestamparia.l.frappe.cloud';

const recordsToDelete = {
    Quotation: [
        "ORC-2026-1098",
        "ORC-2026-1115",
        "ORC-20261165",
        "ORC-20261170",
        "ORC-20261171"
    ],
    "CRM Deal": [
        "CRM-DEAL-2026-00116",
        "CRM-DEAL-2026-00152"
    ],
    Lead: [
        "CRM-LEAD-2026-00005"
    ],
    Customer: [
        "Andrei",
        "Andrei - 1",
        "Andrei Bran",
        "Andrei Alves",
        "Andrei Brandao"
    ],
    Contact: [
        "Andrei",
        "Andrei Brandão Alves",
        "Andrei Bran-Andrei Bran-1",
        "Andrei-Andrei - 1",
        "Andrei-1",
        "Andrei-CRM-LEAD-2026-00005"
    ],
    Communication: [
        "2ts1rl63fu",
        "0p7vjuia4e",
        "74u56b5325",
        "d99cbfr8oi",
        "flv5cnqee7"
    ]
};

async function deleteRecord(doctype, name) {
    return new Promise((resolve, reject) => {
        const url = `${instance}/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
        const options = {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${token}`
            }
        };
        const req = https.request(url, options, (res) => {
            if (res.statusCode === 200 || res.statusCode === 202) {
                console.log(`Successfully deleted ${doctype}: ${name}`);
                resolve();
            } else {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    console.error(`Failed to delete ${doctype}: ${name}. Status: ${res.statusCode}. Response: ${data}`);
                    resolve(); // Continue anyway
                });
            }
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    // Order matters for referential integrity
    const order = ['Quotation', 'CRM Deal', 'Lead', 'Customer', 'Contact', 'Communication'];
    
    for (const doctype of order) {
        const names = recordsToDelete[doctype];
        if (!names) continue;
        console.log(`Deleting ${doctype} records...`);
        for (const name of names) {
            await deleteRecord(doctype, name);
        }
    }
}

main();
```

- [x] **Step 2: Run the script**

Run: `node scripts/delete_test_records.mjs`
Expected: Success messages for all records.

- [x] **Step 3: Verify deletion**

Run a query to ensure no records with "Andrei" remain in these doctypes.

- [x] **Step 4: Commit and Cleanup**

```bash
rm scripts/delete_test_records.mjs
git add .
git commit -m "chore: delete test records for Andrei"
```
