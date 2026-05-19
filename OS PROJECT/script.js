class ProcessSimulator {
    constructor() {
        this.processes = [{
            pid: 1,
            name: "INIT",
            state: "RUNNING",
            ppid: 0,
            children: []
        }];
        this.nextPid = 2;
        this.selectedProcessId = null;
        this.isPaused = false;

        this.init();
    }

    init() {
        this.render();
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('btn-create-parent').onclick = () => this.createProcess("Parent", 1);
        document.getElementById('btn-create-child').onclick = () => {
            if (this.selectedProcessId && this.selectedProcessId !== 1) {
                this.createProcess("Child", this.selectedProcessId);
            } else {
                this.log("Select a valid Parent process first!", "warning");
            }
        };

        document.getElementById('btn-kill-child').onclick = () => this.terminateProcess(this.selectedProcessId, false);
        document.getElementById('btn-kill-parent').onclick = () => this.terminateProcess(this.selectedProcessId, true);
        document.getElementById('btn-reap').onclick = () => this.reapProcess(this.selectedProcessId);
        document.getElementById('btn-reset').onclick = () => this.reset();
        
        document.getElementById('btn-pause').onclick = (e) => {
            this.isPaused = !this.isPaused;
            e.target.innerHTML = this.isPaused ? '<i class="fas fa-play"></i> Resume' : '<i class="fas fa-pause"></i> Pause';
        };
    }

    createProcess(type, ppid) {
        if (this.isPaused) return;
        const newProc = {
            pid: this.nextPid++,
            name: `${type} ${String.fromCharCode(64 + this.nextPid)}`,
            state: "RUNNING",
            ppid: ppid,
            children: []
        };
        this.processes.push(newProc);
        const parent = this.processes.find(p => p.pid === ppid);
        parent.children.push(newProc.pid);
        
        this.log(`${type} created (PID ${newProc.pid}) under PID ${ppid}`, "info");
        this.render();
    }

    terminateProcess(pid, isParentKill) {
        const proc = this.processes.find(p => p.pid === pid);
        if (!proc || pid === 1) return;

        if (isParentKill) {
            // All children become ORPHANS and move to INIT (PID 1)
            const initProc = this.processes.find(p => p.pid === 1);
            proc.children.forEach(childPid => {
                const child = this.processes.find(p => p.pid === childPid);
                child.ppid = 1;
                child.state = "ORPHAN";
                initProc.children.push(childPid);
            });
            proc.children = [];
            proc.state = "TERMINATED";
            this.log(`Parent PID ${pid} killed. Children orphaned and adopted by INIT.`, "warning");
        } else {
            // Child dies. If parent is running and doesn't wait, child becomes ZOMBIE
            proc.state = "ZOMBIE";
            this.log(`Child PID ${pid} terminated. State: ZOMBIE (waiting for parent reap)`, "error");
        }
        this.render();
    }

    reapProcess(pid) {
        const proc = this.processes.find(p => p.pid === pid);
        if (proc && proc.state === "ZOMBIE") {
            const parent = this.processes.find(p => p.pid === proc.ppid);
            parent.children = parent.children.filter(id => id !== pid);
            this.processes = this.processes.filter(p => p.pid !== pid);
            this.log(`Zombie PID ${pid} reaped by parent. Resources cleared.`, "info");
            this.selectedProcessId = null;
            this.render();
        } else {
            this.log("Only ZOMBIE processes can be reaped.", "warning");
        }
    }

    log(msg, type) {
        const logBox = document.getElementById('event-log');
        const time = new Date().toLocaleTimeString().split(' ')[0];
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.innerHTML = `[${time}] ${msg}`;
        logBox.prepend(div);
    }

    selectProcess(pid) {
        this.selectedProcessId = pid;
        const proc = this.processes.find(p => p.pid === pid);
        document.getElementById('detail-name').innerText = proc.name;
        document.getElementById('detail-pid').innerText = proc.pid;
        document.getElementById('detail-state').innerText = proc.state;
        document.getElementById('detail-ppid').innerText = proc.ppid;
        this.render();
    }

    renderTree(pid) {
        const proc = this.processes.find(p => p.pid === pid);
        if (!proc) return '';

        let html = `
            <div class="process-node">
                <div class="process-card state-${proc.state} ${this.selectedProcessId === pid ? 'selected' : ''}" 
                     onclick="sim.selectProcess(${pid})">
                    <strong>${proc.name}</strong><br>
                    <small>PID: ${proc.pid} | ${proc.state}</small>
                    ${proc.state === 'ZOMBIE' ? ' <i class="fas fa-skull"></i>' : ''}
                </div>
                ${proc.children.map(childPid => this.renderTree(childPid)).join('')}
            </div>
        `;
        return html;
    }

    render() {
        const treeContainer = document.getElementById('process-tree-container');
        treeContainer.innerHTML = this.renderTree(1);
        document.getElementById('global-process-count').innerText = `${this.processes.length} Processes`;
    }

    reset() {
        this.processes = [{ pid: 1, name: "INIT", state: "RUNNING", ppid: 0, children: [] }];
        this.nextPid = 2;
        this.selectedProcessId = null;
        this.log("System Reset", "info");
        this.render();
    }
}

const sim = new ProcessSimulator();