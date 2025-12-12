// Package temporal provides Temporal client and workflow/activity utilities.
package temporal

import (
	"context"
	"fmt"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"

	"github.com/nucleus/metadata-api/internal/config"
)

// Client wraps the Temporal client with helper methods.
type Client struct {
	client    client.Client
	taskQueue string
}

// NewClient creates a new Temporal client.
func NewClient(cfg *config.Config) (*Client, error) {
	c, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Temporal: %w", err)
	}

	return &Client{
		client:    c,
		taskQueue: cfg.TemporalTaskQueue,
	}, nil
}

// Close closes the Temporal client connection.
func (c *Client) Close() {
	c.client.Close()
}

// TaskQueue returns the default task queue name.
func (c *Client) TaskQueue() string {
	return c.taskQueue
}

// Client returns the underlying Temporal client.
func (c *Client) Client() client.Client {
	return c.client
}

// =============================================================================
// WORKFLOW EXECUTION HELPERS
// =============================================================================

// WorkflowOptions creates standard workflow options.
func (c *Client) WorkflowOptions(workflowID string) client.StartWorkflowOptions {
	return client.StartWorkflowOptions{
		ID:                       workflowID,
		TaskQueue:                c.taskQueue,
		WorkflowExecutionTimeout: 30 * time.Minute,
		WorkflowTaskTimeout:      10 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
		},
	}
}

// ExecuteWorkflow starts a workflow and waits for completion.
func (c *Client) ExecuteWorkflow(ctx context.Context, workflowID string, workflow interface{}, args ...interface{}) (client.WorkflowRun, error) {
	opts := c.WorkflowOptions(workflowID)
	return c.client.ExecuteWorkflow(ctx, opts, workflow, args...)
}

// StartWorkflow starts a workflow without waiting.
func (c *Client) StartWorkflow(ctx context.Context, workflowID string, workflow interface{}, args ...interface{}) (client.WorkflowRun, error) {
	opts := c.WorkflowOptions(workflowID)
	return c.client.ExecuteWorkflow(ctx, opts, workflow, args...)
}

// =============================================================================
// SCHEDULE HELPERS
// =============================================================================

// CreateSchedule creates a new Temporal schedule.
func (c *Client) CreateSchedule(ctx context.Context, scheduleID string, cronExpr string, timezone string, workflow interface{}, args ...interface{}) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	
	// Check if schedule exists
	_, err := handle.Describe(ctx)
	if err == nil {
		// Schedule exists, update it
		return c.UpdateSchedule(ctx, scheduleID, cronExpr, timezone, workflow, args...)
	}

	// Create new schedule
	_, err = c.client.ScheduleClient().Create(ctx, client.ScheduleOptions{
		ID: scheduleID,
		Spec: client.ScheduleSpec{
			CronExpressions: []string{cronExpr},
			TimeZoneName:    timezone,
		},
		Action: &client.ScheduleWorkflowAction{
			ID:        scheduleID + "-run",
			Workflow:  workflow,
			Args:      args,
			TaskQueue: c.taskQueue,
		},
	})
	return err
}

// UpdateSchedule updates an existing schedule.
func (c *Client) UpdateSchedule(ctx context.Context, scheduleID string, cronExpr string, timezone string, workflow interface{}, args ...interface{}) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	
	return handle.Update(ctx, client.ScheduleUpdateOptions{
		DoUpdate: func(input client.ScheduleUpdateInput) (*client.ScheduleUpdate, error) {
			input.Description.Schedule.Spec = &client.ScheduleSpec{
				CronExpressions: []string{cronExpr},
				TimeZoneName:    timezone,
			}
			input.Description.Schedule.Action = &client.ScheduleWorkflowAction{
				ID:        scheduleID + "-run",
				Workflow:  workflow,
				Args:      args,
				TaskQueue: c.taskQueue,
			}
			return &client.ScheduleUpdate{
				Schedule: &input.Description.Schedule,
			}, nil
		},
	})
}

// PauseSchedule pauses a schedule.
func (c *Client) PauseSchedule(ctx context.Context, scheduleID string) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	return handle.Pause(ctx, client.SchedulePauseOptions{})
}

// UnpauseSchedule unpauses a schedule.
func (c *Client) UnpauseSchedule(ctx context.Context, scheduleID string) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	return handle.Unpause(ctx, client.ScheduleUnpauseOptions{})
}

// DeleteSchedule deletes a schedule.
func (c *Client) DeleteSchedule(ctx context.Context, scheduleID string) error {
	handle := c.client.ScheduleClient().GetHandle(ctx, scheduleID)
	return handle.Delete(ctx)
}
