import sqlite3, json, os
db = os.path.join(os.path.dirname(__file__), "fixture.db")
if os.path.exists(db): os.remove(db)
conn = sqlite3.connect(db)
c = conn.cursor()
c.execute("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER)")
c.execute("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)")
c.execute("INSERT INTO session VALUES ('s1','p1',NULL,'C:/git/demo','Session demo',1700000000000)")
c.execute("INSERT INTO message VALUES ('m1','s1',1700000000000,?)", (json.dumps({
    "role":"assistant","providerID":"llmproxy","modelID":"openai/gpt-4.1","cost":0,
    "tokens":{"input":1000000,"output":100000,"reasoning":0,"cache":{"read":0,"write":0}}}),))
c.execute("INSERT INTO message VALUES ('m2','s1',1700000001000,?)", (json.dumps({
    "role":"assistant","providerID":"llmproxy","modelID":"openai/gpt-4.1","cost":0,
    "tokens":{"input":500000,"output":50000,"reasoning":10000,"cache":{"read":200000,"write":0}}}),))
c.execute("INSERT INTO session VALUES ('s2','p1','s1','C:/git/demo','Subagent demo',1700000002000)")
c.execute("INSERT INTO message VALUES ('m3','s2',1700000002000,?)", (json.dumps({
    "role":"assistant","providerID":"openrama","modelID":"qwen3.8-27b","cost":0,
    "tokens":{"input":999999,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}}),))
c.execute("INSERT INTO message VALUES ('m4','s1',1700000003000,?)", (json.dumps({"role":"user","content":"hi"}),))
conn.commit(); conn.close()
print("fixture.db cree")
