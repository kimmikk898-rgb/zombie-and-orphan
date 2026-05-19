import os
import time
import random
import sqlite3
from threading import Thread, Lock
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = 'os_simulation_secret_key_101'
DATABASE = 'database.db'

# In-memory process simulation table
# Protected by a Thread Lock to ensure safe updates
process_lock = Lock()
simulated_processes = {}
next_pid = 2000

# Global system metrics
system_metrics = {
    "cpu_usage": 12.5,
    "memory_usage": 42.1,
    "zombie_count": 0,
    "orphan_count": 0,
    "total_created": 0
}

# --- DATABASE SETUP ---
def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS simulation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                event_type TEXT,
                description TEXT
            )
        ''')
        conn.commit()

# --- SIMULATION ENGINE ENGINE ---
# Updates processes in background to emulate OS lifecycle ticks
def background_simulation_loop():
    global next_pid
    while True:
        time.sleep(1)
        with process_lock:
            # Simulate subtle fluctuation in system CPU/Memory
            system_metrics["cpu_usage"] = round(max(5.0, min(95.0, system_metrics["cpu_usage"] + random.uniform(-3, 3))), 1)
            system_metrics["memory_usage"] = round(max(20.0, min(85.0, system_metrics["memory_usage"] + random.uniform(-1, 1))), 1)
            
            zombies = 0
            orphans = 0
            
            pids_to_delete = []
            
            for pid, proc in list(simulated_processes.items()):
                # Handle Running states
                if proc['status'] == 'Running':
                    # Randomly progress children lifetimes if not infinite
                    if proc['ppid'] != 1 and random.random() < 0.1: 
                        # Child finishes execution naturally!
                        parent_pid = proc['ppid']
                        if parent_pid in simulated_processes and simulated_processes[parent_pid]['status'] == 'Running':
                            proc['status'] = 'Zombie'
                        else:
                            # Parent is already dead/gone, gets adopted by init
                            proc['ppid'] = 1
                            proc['status'] = 'Orphan'
                
                # Count current anomalies
                if proc['status'] == 'Zombie':
                    zombies += 1
                if proc['status'] == 'Orphan':
                    orphans += 1
                    
            system_metrics["zombie_count"] = zombies
            system_metrics["orphan_count"] = orphans

# --- FLASK ROUTING & CONTROLLERS ---

@app.route('/')
def index():
    if 'user_id' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username')
    password = request.form.get('password')
    hashed_pw = generate_password_hash(password)
    
    try:
        with get_db() as conn:
            conn.execute('INSERT INTO users (username, password) VALUES (?, ?)', (username, hashed_pw))
            conn.commit()
        return jsonify({"success": True, "message": "Registration complete! Please Login."})
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "message": "Username already exists."})

@app.route('/login', methods=['POST'])
def login():
    username = request.form.get('username')
    password = request.form.get('password')
    
    with get_db() as conn:
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        
    if user and check_password_hash(user['password'], password):
        session['user_id'] = user['id']
        session['username'] = user['username']
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Invalid username or password."})

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/dashboard')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('index'))
    return render_template('dashboard.html', username=session['username'])

# --- SIMULATION API ENDPOINTS ---

@app.route('/api/state', methods=['GET'])
def get_state():
    with process_lock:
        return jsonify({
            "metrics": system_metrics,
            "processes": list(simulated_processes.values())
        })

@app.route('/api/process/create_parent', methods=['POST'])
def create_parent():
    global next_pid
    if 'user_id' not in session: return jsonify({"error": "Unauthorized"}), 401
    
    with process_lock:
        pid = next_pid
        next_pid += 1
        simulated_processes[pid] = {
            "pid": pid,
            "ppid": 1, # Main System System
            "name": f"Parent_Proc_{pid}",
            "status": "Running"
        }
        system_metrics["total_created"] += 1
        
        with get_db() as conn:
            conn.execute('INSERT INTO simulation_logs (user_id, event_type, description) VALUES (?, ?, ?)',
                         (session['user_id'], 'CREATE_PARENT', f"Spawned root parent process PID {pid}"))
            conn.commit()
            
    return jsonify({"success": True, "pid": pid})

@app.route('/api/process/fork', methods=['POST'])
def fork_child():
    global next_pid
    parent_pid = int(request.json.get('parent_pid', 0))
    
    with process_lock:
        if parent_pid not in simulated_processes or simulated_processes[parent_pid]['status'] != 'Running':
            return jsonify({"success": False, "message": "Active Parent PID required to fork."})
            
        pid = next_pid
        next_pid += 1
        simulated_processes[pid] = {
            "pid": pid,
            "ppid": parent_pid,
            "name": f"Child_Proc_{pid}",
            "status": "Running"
        }
        system_metrics["total_created"] += 1
    return jsonify({"success": True, "pid": pid})

@app.route('/api/process/terminate', methods=['POST'])
def terminate_process():
    pid = int(request.json.get('pid', 0))
    
    with process_lock:
        if pid not in simulated_processes:
            return jsonify({"success": False, "message": "Process not found."})
            
        proc = simulated_processes[pid]
        
        # Scenario A: Terminating a Child before Parent reaps it -> Becomes Zombie
        if proc['ppid'] != 1 and proc['status'] == 'Running':
            parent_id = proc['ppid']
            if parent_id in simulated_processes and simulated_processes[parent_id]['status'] == 'Running':
                proc['status'] = 'Zombie'
            else:
                # Parent was already dead, instantly orphan / handled by init
                proc['status'] = 'Orphan'
                proc['ppid'] = 1
                
        # Scenario B: Terminating a Parent with active children -> Children become Orphans
        elif proc['status'] == 'Running' or proc['status'] == 'Orphan':
            # Kill the process
            del simulated_processes[pid]
            # Orphan its children
            for child_pid, child_proc in simulated_processes.items():
                if child_proc['ppid'] == pid:
                    child_proc['ppid'] = 1 # Adopted by init
                    if child_proc['status'] == 'Running':
                        child_proc['status'] = 'Orphan'
        else:
            # Clear explicitly out if user terminates an existing zombie/orphan
            del simulated_processes[pid]
            
    return jsonify({"success": True})

@app.route('/api/process/reap', methods=['POST'])
def reap_zombies():
    """ Simulates calling wait() or waitpid() from parent to clear zombies """
    with process_lock:
        to_remove = [pid for pid, proc in simulated_processes.items() if proc['status'] == 'Zombie']
        for pid in to_remove:
            del simulated_processes[pid]
    return jsonify({"success": True, "reaped": len(to_remove)})

@app.route('/api/process/reset', methods=['POST'])
def reset_simulation():
    with process_lock:
        simulated_processes.clear()
        system_metrics["zombie_count"] = 0
        system_metrics["orphan_count"] = 0
        system_metrics["total_created"] = 0
    return jsonify({"success": True})

if __name__ == '__main__':
    init_db()
    # Spin up background thread loop to maintain simulation ticks
    Thread(target=background_simulation_loop, daemon=True).start()
    app.run(debug=True, port=5000)
