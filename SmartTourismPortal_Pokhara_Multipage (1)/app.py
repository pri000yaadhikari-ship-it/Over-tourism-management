from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
app=Flask(__name__); CORS(app)
def db():
 c=sqlite3.connect('tourism.db'); c.execute('CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY, rating INTEGER NOT NULL, comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)'); return c
@app.post('/api/reviews')
def review():
 d=request.get_json() or {}; rating=d.get('rating')
 if not isinstance(rating,int) or rating not in range(1,6): return jsonify(error='Rating must be 1 to 5'),400
 c=db(); c.execute('INSERT INTO reviews(rating,comment) VALUES(?,?)',(rating,str(d.get('comment',''))[:1000])); c.commit(); c.close()
 return jsonify(success=True),201
if __name__=='__main__': app.run(debug=True)
