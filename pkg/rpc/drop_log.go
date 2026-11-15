package rpc

import (
	"sync"
	"time"

	"go.uber.org/zap"
)

// dropSummaryInterval is the least time between two of a transport's Warn
// summaries of the frames it rejected or dropped.
const dropSummaryInterval = 10 * time.Second

type dropReason int

const (
	dropCallLimit dropReason = iota
	dropHeaderLimit
	dropRejection
	dropMalformed
	dropReasons
)

var dropReasonKeys = [dropReasons]string{
	dropCallLimit:   "overCallLimit",
	dropHeaderLimit: "overHeaderLimit",
	dropRejection:   "droppedRejections",
	dropMalformed:   "malformed",
}

// dropLog counts a transport's rejected and dropped frames by reason. It
// logs the counts at Warn on the first drop after dropSummaryInterval has
// passed since its last summary, and on flush. It is safe for concurrent
// use.
type dropLog struct {
	logger *zap.Logger
	now    func() time.Time // nil means time.Now

	mu     sync.Mutex
	counts [dropReasons]int
	logged bool
	last   time.Time // of the last summary
}

func (l *dropLog) add(r dropReason) {
	now := time.Now
	if l.now != nil {
		now = l.now
	}

	l.mu.Lock()
	defer l.mu.Unlock()
	l.counts[r]++
	if t := now(); !l.logged || t.Sub(l.last) >= dropSummaryInterval {
		l.logged = true
		l.last = t
		l.logLocked()
	}
}

// flush logs the counts not yet summarized, if any.
func (l *dropLog) flush() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.logLocked()
}

func (l *dropLog) logLocked() {
	if l.counts == [dropReasons]int{} {
		return
	}
	fields := make([]zap.Field, dropReasons)
	for r, n := range l.counts {
		fields[r] = zap.Int(dropReasonKeys[r], n)
	}
	l.logger.Warn("rpc transport rejected or dropped frames", fields...)
	l.counts = [dropReasons]int{}
}
