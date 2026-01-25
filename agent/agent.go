package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"
)

// AgentConfig holds agent configuration
type AgentConfig struct {
	Debug      bool
	SocketPath string
	ConfigPath string
}

// Agent represents the nPanel local agent
type Agent struct {
	config     *AgentConfig
	listener   net.Listener
	actions    map[string]Action
	logger     *Logger
	mu         sync.RWMutex
	shutdown   chan struct{}
	workerPool *WorkerPool
}

// NewAgent creates a new agent instance
func NewAgent(config *AgentConfig) (*Agent, error) {
	agent := &Agent{
		config:     config,
		actions:    make(map[string]Action),
		logger:     NewLogger(config.Debug),
		shutdown:   make(chan struct{}),
		workerPool: NewWorkerPool(5),
	}

	// Register allowed actions
	agent.registerActions()

	return agent, nil
}

// Start starts the agent and begins listening for requests
func (a *Agent) Start() error {
	a.logger.Info("Starting agent on socket: %s", a.config.SocketPath)

	// Clean up old socket if it exists
	os.Remove(a.config.SocketPath)

	// Create Unix domain socket listener
	listener, err := net.Listen("unix", a.config.SocketPath)
	if err != nil {
		return fmt.Errorf("failed to listen on socket: %w", err)
	}
	a.listener = listener
	defer listener.Close()

	// Set restrictive permissions on socket
	if err := os.Chmod(a.config.SocketPath, 0700); err != nil {
		return fmt.Errorf("failed to set socket permissions: %w", err)
	}

	a.logger.Info("Agent listening on %s", a.config.SocketPath)
	fmt.Printf("✓ Agent listening on %s\n", a.config.SocketPath)

	// Accept connections
	for {
		select {
		case <-a.shutdown:
			return nil
		default:
		}

		conn, err := listener.Accept()
		if err != nil {
			a.logger.Error("Accept error: %v", err)
			continue
		}

		// Handle connection in goroutine
		go a.handleConnection(conn)
	}
}

// Shutdown gracefully shuts down the agent
func (a *Agent) Shutdown() error {
	a.logger.Info("Shutting down agent")
	close(a.shutdown)

	if a.listener != nil {
		a.listener.Close()
	}

	a.workerPool.Shutdown()

	// Clean up socket
	os.Remove(a.config.SocketPath)

	return nil
}

// handleConnection handles a single client connection
func (a *Agent) handleConnection(conn net.Conn) {
	defer conn.Close()

	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	// Read request
	var req ActionRequest
	if err := decoder.Decode(&req); err != nil {
		a.logger.Error("Failed to decode request: %v", err)
		encoder.Encode(map[string]interface{}{
			"error": "Invalid request format",
		})
		return
	}

	a.logger.Info("Received action: %s", req.Action)

	// Validate request
	if err := req.Validate(); err != nil {
		encoder.Encode(map[string]interface{}{
			"error": err.Error(),
		})
		return
	}

	// Check if action is allowed
	a.mu.RLock()
	action, exists := a.actions[req.Action]
	a.mu.RUnlock()

	if !exists {
		a.logger.Error("Unknown action: %s", req.Action)
		encoder.Encode(map[string]interface{}{
			"error": fmt.Sprintf("Unknown action: %s", req.Action),
		})
		return
	}

	// Execute action via worker pool
	result := a.workerPool.Submit(func() interface{} {
		resp, err := action.Execute(req)
		if err != nil {
			return map[string]interface{}{
				"error": err.Error(),
			}
		}
		return resp
	})

	// Send response
	encoder.Encode(result)
}

// registerActions registers all allowed actions
func (a *Agent) registerActions() {
	// Domain actions
	a.registerAction("domain.create", &CreateDomainAction{})
	a.registerAction("domain.delete", &DeleteDomainAction{})
	a.registerAction("domain.list", &ListDomainsAction{})

	// Email actions
	a.registerAction("email.create", &CreateEmailAction{})
	a.registerAction("email.delete", &DeleteEmailAction{})

	// Service actions
	a.registerAction("service.restart", &RestartServiceAction{})
	a.registerAction("service.status", &ServiceStatusAction{})

	// System actions
	a.registerAction("system.health", &SystemHealthAction{})
}

// registerAction registers a single action
func (a *Agent) registerAction(name string, action Action) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.actions[name] = action
	a.logger.Info("Registered action: %s", name)
}

// ActionRequest represents a request to execute an action
type ActionRequest struct {
	Action    string                 `json:"action"`
	Params    map[string]interface{} `json:"params"`
	RequestID string                 `json:"request_id"`
	Timestamp int64                  `json:"timestamp"`
}

// Validate validates the request
func (r *ActionRequest) Validate() error {
	if r.Action == "" {
		return fmt.Errorf("action is required")
	}
	if r.RequestID == "" {
		r.RequestID = generateID()
	}
	if r.Timestamp == 0 {
		r.Timestamp = time.Now().Unix()
	}
	return nil
}

// Action interface for executable actions
type Action interface {
	Execute(req ActionRequest) (interface{}, error)
}

// Action implementations

// CreateDomainAction creates a new domain
type CreateDomainAction struct{}

func (a *CreateDomainAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement domain creation
	return map[string]interface{}{
		"status": "created",
		"domain": req.Params["domain"],
	}, nil
}

// DeleteDomainAction deletes a domain
type DeleteDomainAction struct{}

func (a *DeleteDomainAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement domain deletion
	return map[string]interface{}{
		"status": "deleted",
		"domain": req.Params["domain"],
	}, nil
}

// ListDomainsAction lists all domains
type ListDomainsAction struct{}

func (a *ListDomainsAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement domain listing
	return map[string]interface{}{
		"domains": []string{},
	}, nil
}

// CreateEmailAction creates a new email account
type CreateEmailAction struct{}

func (a *CreateEmailAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement email creation
	return map[string]interface{}{
		"status": "created",
		"email":  req.Params["email"],
	}, nil
}

// DeleteEmailAction deletes an email account
type DeleteEmailAction struct{}

func (a *DeleteEmailAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement email deletion
	return map[string]interface{}{
		"status": "deleted",
		"email":  req.Params["email"],
	}, nil
}

// RestartServiceAction restarts a service
type RestartServiceAction struct{}

func (a *RestartServiceAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement service restart
	return map[string]interface{}{
		"status": "restarted",
		"service": req.Params["service"],
	}, nil
}

// ServiceStatusAction gets service status
type ServiceStatusAction struct{}

func (a *ServiceStatusAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement status check
	return map[string]interface{}{
		"status": "running",
		"service": req.Params["service"],
	}, nil
}

// SystemHealthAction checks system health
type SystemHealthAction struct{}

func (a *SystemHealthAction) Execute(req ActionRequest) (interface{}, error) {
	// TODO: Implement health check
	return map[string]interface{}{
		"status": "healthy",
		"uptime": "24h",
	}, nil
}

// Logger provides agent logging
type Logger struct {
	debug bool
}

// NewLogger creates a new logger
func NewLogger(debug bool) *Logger {
	return &Logger{debug: debug}
}

// Info logs an info message
func (l *Logger) Info(format string, args ...interface{}) {
	if l.debug {
		log.Printf("[INFO] "+format, args...)
	}
}

// Error logs an error message
func (l *Logger) Error(format string, args ...interface{}) {
	log.Printf("[ERROR] "+format, args...)
}

// WorkerPool manages concurrent action execution
type WorkerPool struct {
	workers int
	jobs    chan func() interface{}
	results chan interface{}
	done    chan struct{}
}

// NewWorkerPool creates a new worker pool
func NewWorkerPool(workers int) *WorkerPool {
	pool := &WorkerPool{
		workers: workers,
		jobs:    make(chan func() interface{}, workers),
		results: make(chan interface{}, workers),
		done:    make(chan struct{}),
	}

	// Start workers
	for i := 0; i < workers; i++ {
		go pool.worker()
	}

	return pool
}

// worker processes jobs from the pool
func (p *WorkerPool) worker() {
	for {
		select {
		case job := <-p.jobs:
			if job == nil {
				return
			}
			result := job()
			select {
			case p.results <- result:
			case <-p.done:
				return
			}
		case <-p.done:
			return
		}
	}
}

// Submit submits a job to the pool
func (p *WorkerPool) Submit(job func() interface{}) interface{} {
	p.jobs <- job
	return <-p.results
}

// Shutdown shuts down the worker pool
func (p *WorkerPool) Shutdown() {
	close(p.done)
	for i := 0; i < p.workers; i++ {
		p.jobs <- nil
	}
}

// generateID generates a unique ID
func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
