package service

import (
	"encoding/json"
	"time"

	"github.com/seifghazi/claude-code-monitor/internal/config"
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

type StorageService interface {
	SaveRequest(request *model.RequestLog) (string, error)
	GetRequests(page, limit int) ([]model.RequestLog, int, error)
	ClearRequests() (int, error)
	UpdateRequestWithGrading(requestID string, grade *model.PromptGrade) error
	UpdateRequestWithResponse(request *model.RequestLog) error
	EnsureDirectoryExists() error
	GetRequestByShortID(shortID string) (*model.RequestLog, string, error)
	GetConfig() *config.StorageConfig
	GetAllRequests(modelFilter string) ([]*model.RequestLog, error)
	GetUsage(page, limit int, sortBy, sortOrder string) ([]model.UsageRecord, int, error)
	GetPricing() ([]model.PricingModel, error)
	GetHourlyUsage() ([]model.HourlyUsage, error)
	// New methods for week-based pagination and stats
	GetRequestsSummary(modelFilter, startTime, endTime string) ([]*model.RequestSummary, int, error)
	GetStats(startDate, endDate string) (*model.DashboardStats, error)
	GetHourlyStats(startTime, endTime string) (*model.HourlyStatsResponse, error)
	GetModelStats(startTime, endTime string) (*model.ModelStatsResponse, error)
	GetLatestRequestDate() (*time.Time, error)
	// Turns tab methods
	GetTurns(startTime, endTime, sortBy, sortOrder string) ([]model.TurnSummary, int, error)
	GetMessageContent(id int64) (*model.MessageContentRecord, error)
	// Live indexing
	IndexRequest(requestID, timestamp string, body, response json.RawMessage) error
}
