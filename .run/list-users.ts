import Database from "better-sqlite3";
const db = new Database("data/civicsignal.db", { readonly: true });
console.log(db.prepare("SELECT email, role, status, organization_id FROM users ORDER BY created_at").all());
console.log("sessions:", db.prepare("SELECT COUNT(*) AS count FROM sessions").get());
console.log("reports:", db.prepare("SELECT COUNT(*) AS count FROM reports").get());
db.close();
