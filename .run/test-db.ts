import Database from "better-sqlite3";
console.log("imported");
const db = new Database("data/civicsignal.db", { timeout: 0 });
console.log("opened");
console.log("journal:", db.pragma("journal_mode"));
console.log("users:", db.prepare("SELECT COUNT(*) AS count FROM users").get());
db.close();
console.log("closed");
