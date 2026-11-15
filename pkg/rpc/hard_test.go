package rpc

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pb "github.com/MemeLabs/protobuf/pkg/apis/rpc"
	"github.com/MemeLabs/protobuf/pkg/bytereader"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

// Package-level identifiers in this file start with hard (or TestHard,
// FuzzHard) so they don't collide with the other tests in this package.

type hardHeader struct {
	key   string
	value []byte
}

// hardHeaders returns n distinct headers with one-byte values.
func hardHeaders(n int) []hardHeader {
	h := make([]hardHeader, n)
	for i := range h {
		h[i] = hardHeader{strconv.FormatInt(int64(i), 36), []byte{1}}
	}
	return h
}

// hardHeaderEntry encodes a header map entry without its tag and length.
func hardHeaderEntry(h hardHeader) []byte {
	var e []byte
	e = protowire.AppendTag(e, 1, protowire.BytesType)
	e = protowire.AppendString(e, h.key)
	e = protowire.AppendTag(e, 2, protowire.BytesType)
	return protowire.AppendBytes(e, h.value)
}

// hardHeaderOfSize returns a header whose encoded entry is n bytes.
func hardHeaderOfSize(t testing.TB, n int) hardHeader {
	t.Helper()
	for v := max(n-8, 0); v <= n; v++ {
		h := hardHeader{"k", make([]byte, v)}
		if len(hardHeaderEntry(h)) == n {
			return h
		}
	}
	t.Fatalf("no header entry of %d bytes", n)
	return hardHeader{}
}

// hardFrame encodes c, which must have no headers, followed by headers as
// they are given, duplicates included.
func hardFrame(t testing.TB, c *pb.Call, headers ...hardHeader) []byte {
	t.Helper()
	b, err := proto.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range headers {
		b = protowire.AppendTag(b, 6, protowire.BytesType)
		b = protowire.AppendBytes(b, hardHeaderEntry(h))
	}
	return b
}

func hardArg(t *testing.T) []byte {
	t.Helper()
	return srvMarshal(t, &pb.Error{Message: "arg"})
}

// hardPeer is the raw far end of an RWTransport: it writes frames as given
// and, once reading, decodes the frames it receives into recv.
type hardPeer struct {
	rw   *cliPipeRW
	tr   *RWTransport
	recv chan *pb.Call
	stop context.CancelFunc
	done chan error // Listen's result
}

// hardServe runs an RWTransport for disp and returns its far end.
func hardServe(t *testing.T, disp Dispatcher, dialer func(*RWDialer)) *hardPeer {
	t.Helper()
	peerRW, rw := cliNewPipePair(t)
	d := &RWDialer{Logger: zap.NewNop(), ReadWriter: rw}
	if dialer != nil {
		dialer(d)
	}
	ctx, cancel := context.WithCancel(context.Background())
	tr, err := d.Dial(ctx, disp)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	p := &hardPeer{
		rw:   peerRW,
		tr:   tr.(*RWTransport),
		recv: make(chan *pb.Call, 1024),
		stop: cancel,
		done: make(chan error, 1),
	}
	go func() { p.done <- tr.Listen() }()
	t.Cleanup(cancel)
	return p
}

func (p *hardPeer) startReading() {
	go func() {
		br := bytereader.New(p.rw)
		for {
			l, err := binary.ReadUvarint(br)
			if err != nil {
				return
			}
			b := make([]byte, l)
			if _, err := io.ReadFull(p.rw, b); err != nil {
				return
			}
			c := &pb.Call{}
			if err := proto.Unmarshal(b, c); err != nil {
				return
			}
			p.recv <- c
		}
	}()
}

func (p *hardPeer) write(t *testing.T, frame []byte) {
	t.Helper()
	if _, err := p.rw.Write(append(binary.AppendUvarint(nil, uint64(len(frame))), frame...)); err != nil {
		t.Fatal(err)
	}
}

func (p *hardPeer) next(t *testing.T) *pb.Call {
	t.Helper()
	select {
	case c := <-p.recv:
		return c
	case <-time.After(2 * time.Second):
		t.Fatal("no frame received")
		return nil
	}
}

// hardWantError fails unless res is an ERROR response to id with message
// msg and code.
func hardWantError(t *testing.T, res *pb.Call, id uint64, msg string, code int32) {
	t.Helper()
	if res.ParentId != id || res.Kind != pb.Call_CALL_KIND_ERROR {
		t.Fatalf("got %v response to %d, want ERROR to %d", res.Kind, res.ParentId, id)
	}
	e := &pb.Error{}
	if err := proto.Unmarshal(res.Argument, e); err != nil {
		t.Fatal(err)
	}
	if e.Message != msg || e.Code != code {
		t.Fatalf("got error %q code %d, want %q code %d", e.Message, e.Code, msg, code)
	}
}

// hardCounter registers method on a new dispatcher as a unary handler that
// counts its calls.
func hardCounter(method string) (*ServiceDispatcher, *atomic.Int32) {
	var n atomic.Int32
	d := NewServiceDispatcher(zap.NewNop())
	d.RegisterMethod(method, func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		n.Add(1)
		return &pb.Error{Message: "ok"}, nil
	})
	return d, &n
}

// hardBlockStream returns a streaming handler that sends nothing and closes
// cancelled when its context is cancelled.
func hardBlockStream(cancelled chan struct{}) func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
	return func(ctx context.Context, req *pb.Error) (<-chan *pb.Error, error) {
		ch := make(chan *pb.Error)
		go func() {
			<-ctx.Done()
			close(cancelled)
			close(ch)
		}()
		return ch, nil
	}
}

// hardGoroutines counts the goroutines running fn.
func hardGoroutines(fn string) int {
	buf := make([]byte, 1<<20)
	for {
		n := runtime.Stack(buf, true)
		if n < len(buf) {
			return strings.Count(string(buf[:n]), fn+"(")
		}
		buf = make([]byte, 2*len(buf))
	}
}

type hardDiscardRW struct{}

func (hardDiscardRW) Read([]byte) (int, error)    { return 0, io.EOF }
func (hardDiscardRW) Write(p []byte) (int, error) { return len(p), nil }

func TestHardScanEnvelope(t *testing.T) {
	var groupField []byte
	groupField = protowire.AppendTag(groupField, 6, protowire.StartGroupType)
	groupField = protowire.AppendTag(groupField, 1, protowire.VarintType)
	groupField = protowire.AppendVarint(groupField, 9)
	groupField = protowire.AppendTag(groupField, 6, protowire.EndGroupType)

	base := hardFrame(t, &pb.Call{Id: 1, ParentId: 2, Method: "m", Argument: []byte("arg")}, hardHeader{"a", []byte("xy")})
	cases := []struct {
		name string
		b    []byte
		want envelope
		err  bool
	}{
		{name: "empty"},
		{name: "fields", b: base, want: envelope{id: 1, parentID: 2, method: []byte("m"), headers: 1, headerBytes: 7}},
		{name: "last wins", b: protowire.AppendVarint(protowire.AppendTag(append([]byte(nil), base...), 1, protowire.VarintType), 5),
			want: envelope{id: 5, parentID: 2, method: []byte("m"), headers: 1, headerBytes: 7}},
		{name: "duplicate headers", b: hardFrame(t, &pb.Call{}, hardHeader{"a", nil}, hardHeader{"a", nil}),
			want: envelope{headers: 2, headerBytes: 10}},
		{name: "headers as group", b: groupField},
		{name: "id as bytes", b: protowire.AppendBytes(protowire.AppendTag(nil, 1, protowire.BytesType), []byte{7})},
		{name: "method as varint", b: protowire.AppendVarint(protowire.AppendTag(nil, 3, protowire.VarintType), 7)},
		{name: "headers as varint", b: protowire.AppendVarint(protowire.AppendTag(nil, 6, protowire.VarintType), 7)},
		{name: "field number 0", b: []byte{0x02, 0x00}, err: true},
		{name: "field number too large", b: protowire.AppendVarint(protowire.AppendTag(nil, protowire.MaxValidNumber+1, protowire.VarintType), 1), err: true},
		{name: "end group", b: protowire.AppendTag(nil, 9, protowire.EndGroupType), err: true},
		{name: "truncated bytes", b: []byte{0x32, 0x05, 0x00}, err: true},
		{name: "truncated varint", b: []byte{0x08, 0x80}, err: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := scanEnvelope(tc.b)
			if (err != nil) != tc.err {
				t.Fatalf("got error %v, want error %v", err, tc.err)
			}
			if err != nil {
				return
			}
			if got.id != tc.want.id || got.parentID != tc.want.parentID || !bytes.Equal(got.method, tc.want.method) ||
				got.headers != tc.want.headers || got.headerBytes != tc.want.headerBytes {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}

	frame := hardFrame(t, &pb.Call{Id: 1, Method: "m"}, hardHeaders(1000)...)
	if allocs := testing.AllocsPerRun(10, func() { _, _ = scanEnvelope(frame) }); allocs != 0 {
		t.Fatalf("scanEnvelope allocated %v times", allocs)
	}
}

// hardRecounter returns a function that decodes an encoded pb.Call as a
// message that checks only the wire format: method is bytes and headers
// are repeated bytes, so each header entry is counted and sized without
// being parsed.
func hardRecounter(f *testing.F) func([]byte) (envelope, error) {
	field := func(name string, num int32, label descriptorpb.FieldDescriptorProto_Label, typ descriptorpb.FieldDescriptorProto_Type) *descriptorpb.FieldDescriptorProto {
		return &descriptorpb.FieldDescriptorProto{
			Name:     proto.String(name),
			JsonName: proto.String(name),
			Number:   proto.Int32(num),
			Label:    label.Enum(),
			Type:     typ.Enum(),
		}
	}
	const (
		optional = descriptorpb.FieldDescriptorProto_LABEL_OPTIONAL
		repeated = descriptorpb.FieldDescriptorProto_LABEL_REPEATED
	)
	fd, err := protodesc.NewFile(&descriptorpb.FileDescriptorProto{
		Name:    proto.String("hard_recount.proto"),
		Package: proto.String("hard"),
		Syntax:  proto.String("proto3"),
		MessageType: []*descriptorpb.DescriptorProto{{
			Name: proto.String("Call"),
			Field: []*descriptorpb.FieldDescriptorProto{
				field("id", 1, optional, descriptorpb.FieldDescriptorProto_TYPE_UINT64),
				field("parent_id", 2, optional, descriptorpb.FieldDescriptorProto_TYPE_UINT64),
				field("method", 3, optional, descriptorpb.FieldDescriptorProto_TYPE_BYTES),
				field("headers", 6, repeated, descriptorpb.FieldDescriptorProto_TYPE_BYTES),
			},
		}},
	}, nil)
	if err != nil {
		f.Fatal(err)
	}
	md := fd.Messages().Get(0)
	fields := md.Fields()
	return func(b []byte) (envelope, error) {
		m := dynamicpb.NewMessage(md)
		if err := proto.Unmarshal(b, m); err != nil {
			return envelope{}, err
		}
		e := envelope{
			id:       m.Get(fields.ByNumber(1)).Uint(),
			parentID: m.Get(fields.ByNumber(2)).Uint(),
			method:   m.Get(fields.ByNumber(3)).Bytes(),
		}
		l := m.Get(fields.ByNumber(6)).List()
		for i := range l.Len() {
			e.headers++
			e.headerBytes += len(l.Get(i).Bytes())
		}
		return e, nil
	}
}

// scanEnvelope fails exactly where a wire-format decode fails, so only
// where proto.Unmarshal does, and otherwise reads the same fields as both.
func FuzzHardScanEnvelope(f *testing.F) {
	tag := func(num protowire.Number, typ protowire.Type) []byte { return protowire.AppendTag(nil, num, typ) }
	cat := func(bs ...[]byte) []byte { return bytes.Join(bs, nil) }
	full := hardFrame(f, &pb.Call{Id: 1, ParentId: 2, Method: "svc.M", Kind: pb.Call_CALL_KIND_ERROR, Argument: []byte{1, 2}},
		hardHeader{"a", []byte("x")}, hardHeader{"a", nil}, hardHeader{"", []byte("yz")})
	group := cat(tag(9, protowire.StartGroupType), tag(1, protowire.VarintType), []byte{1}, tag(9, protowire.EndGroupType))
	for _, seed := range [][]byte{
		nil,
		full,
		cat(full, full),
		cat(tag(1, protowire.BytesType), []byte{1, 7}),
		cat(tag(2, protowire.Fixed64Type), make([]byte, 8)),
		cat(tag(3, protowire.VarintType), []byte{3}),
		cat(tag(3, protowire.BytesType), []byte{1, 0xff}),
		cat(tag(4, protowire.Fixed32Type), make([]byte, 4)),
		cat(tag(5, protowire.VarintType), []byte{5}),
		cat(tag(6, protowire.VarintType), []byte{6}),
		cat(tag(6, protowire.Fixed32Type), make([]byte, 4)),
		cat(tag(6, protowire.StartGroupType), tag(6, protowire.EndGroupType)),
		cat(tag(6, protowire.BytesType), []byte{3, 0x0a, 0x01, 0xff}),
		cat(tag(6, protowire.BytesType), []byte{2, 0xff, 0xff}),
		group,
		cat(tag(1, protowire.VarintType), []byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01}),
		cat(tag(1, protowire.VarintType), []byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02}),
		{0x02, 0x00},
		tag(protowire.MaxValidNumber, protowire.VarintType),
		cat(tag(protowire.MaxValidNumber+1, protowire.VarintType), []byte{0}),
		tag(9, protowire.EndGroupType),
		cat(tag(9, 6), []byte{0}),
		{0x32, 0x05, 0x00},
	} {
		f.Add(seed)
	}

	recount := hardRecounter(f)
	f.Fuzz(func(t *testing.T, b []byte) {
		env, scanErr := scanEnvelope(b)
		wire, wireErr := recount(b)
		c := &pb.Call{}
		err := proto.Unmarshal(b, c)
		if envErr := envelopeUnmarshal.Unmarshal(b, &pb.Call{}); (envErr == nil) != (err == nil) {
			t.Fatalf("envelopeUnmarshal: %v; proto.Unmarshal: %v", envErr, err)
		}

		if (scanErr == nil) != (wireErr == nil) {
			t.Fatalf("scan: %v; wire-format decode: %v", scanErr, wireErr)
		}
		if scanErr != nil {
			if err == nil {
				t.Fatalf("scan failed where proto.Unmarshal succeeds: %v", scanErr)
			}
			return
		}
		if env.id != wire.id || env.parentID != wire.parentID || !bytes.Equal(env.method, wire.method) ||
			env.headers != wire.headers || env.headerBytes != wire.headerBytes {
			t.Fatalf("scanned %+v; wire-format decode %+v", env, wire)
		}

		if err != nil {
			return
		}
		if env.id != c.Id || env.parentID != c.ParentId || string(env.method) != c.Method {
			t.Fatalf("scanned id %d parent %d method %q; decoded %d %d %q", env.id, env.parentID, env.method, c.Id, c.ParentId, c.Method)
		}
		if len(c.Headers) > env.headers {
			t.Fatalf("decoded %d headers from %d entries", len(c.Headers), env.headers)
		}
	})
}

// Requests over either header limit get an ERROR without being dispatched;
// requests at the limits are served.
func TestHardHeaderCapRW(t *testing.T) {
	disp, calls := hardCounter("hard.count")
	p := hardServe(t, disp, nil)
	p.startReading()

	cases := []struct {
		name    string
		headers []hardHeader
		reject  bool
	}{
		{"MaxHeaders entries", hardHeaders(MaxHeaders), false},
		{"MaxHeaders+1 entries", hardHeaders(MaxHeaders + 1), true},
		{"MaxHeaders+1 duplicate entries", make([]hardHeader, MaxHeaders+1), true},
		{"MaxHeaderBytes", []hardHeader{hardHeaderOfSize(t, MaxHeaderBytes)}, false},
		{"MaxHeaderBytes+1", []hardHeader{hardHeaderOfSize(t, MaxHeaderBytes+1)}, true},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := uint64(100 + i)
			before := calls.Load()
			p.write(t, hardFrame(t, &pb.Call{Id: id, Method: "hard.count", Argument: hardArg(t)}, tc.headers...))
			res := p.next(t)
			if tc.reject {
				hardWantError(t, res, id, "rpc: too many headers", 0)
				if n := calls.Load(); n != before {
					t.Fatalf("rejected request was dispatched")
				}
				return
			}
			if res.ParentId != id || res.Kind != pb.Call_CALL_KIND_DEFAULT {
				t.Fatalf("got %v response to %d, want DEFAULT to %d", res.Kind, res.ParentId, id)
			}
			if n := calls.Load(); n != before+1 {
				t.Fatalf("handler ran %d times, want 1", n-before)
			}
		})
	}
}

// An over-limit CANCEL still cancels its call.
func TestHardHeaderCapCancel(t *testing.T) {
	cancelled := make(chan struct{})
	disp := NewServiceDispatcher(zap.NewNop())
	disp.RegisterMethod("hard.block", cliBlock(cancelled))
	p := hardServe(t, disp, nil)
	p.startReading()

	p.write(t, hardFrame(t, &pb.Call{Id: 7, Method: "hard.block", Argument: hardArg(t)}))
	if !cliEventually(time.Second, func() bool { return p.tr.calls.CallIn(7) != nil }) {
		t.Fatal("call not dispatched")
	}
	p.write(t, hardFrame(t, &pb.Call{Id: 8, ParentId: 7, Method: cancelMethod}, hardHeaders(MaxHeaders+1)...))
	cliWaitClosed(t, cancelled, 2*time.Second, "over-limit CANCEL did not cancel the call")
}

// An over-limit response fails its call, which is then cancelled on the
// server.
func TestHardHeaderCapResponse(t *testing.T) {
	unaryCancelled := make(chan struct{})
	streamCancelled := make(chan struct{})
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("hard.block", cliBlock(unaryCancelled))
		d.RegisterMethod("hard.stream", hardBlockStream(streamCancelled))
	}, nil)

	over := map[string][]byte{}
	for _, h := range hardHeaders(MaxHeaders + 1) {
		over[h.key] = h.value
	}
	respond := func(call *CallOut) {
		res := &pb.Call{Id: 1 << 40, ParentId: call.ID(), Method: callbackMethod, Argument: hardArg(t), Headers: over}
		if err := c.serverT.send(context.Background(), res); err != nil {
			t.Fatal(err)
		}
	}

	errc := make(chan error, 1)
	go func() { errc <- c.client.CallUnary(context.Background(), "hard.block", &pb.Error{}, &pb.Error{}) }()
	respond(cliFindCallOut(t, c.clientT))
	if err := cliWaitErr(t, errc, 2*time.Second, "CallUnary"); !errors.Is(err, ErrTooManyHeaders) {
		t.Fatalf("CallUnary returned %v, want ErrTooManyHeaders", err)
	}
	cliWaitClosed(t, unaryCancelled, 2*time.Second, "unary call not cancelled on the server")

	ch := make(chan *pb.Error, 1)
	go func() { errc <- c.client.CallStreaming(context.Background(), "hard.stream", &pb.Error{}, ch) }()
	respond(cliFindCallOut(t, c.clientT))
	if err := cliWaitErr(t, errc, 2*time.Second, "CallStreaming"); !errors.Is(err, ErrTooManyHeaders) {
		t.Fatalf("CallStreaming returned %v, want ErrTooManyHeaders", err)
	}
	cliWaitClosed(t, streamCancelled, 2*time.Second, "stream not cancelled on the server")
}

func TestHardHeaderCapHTTP(t *testing.T) {
	s := NewHTTPServer(zap.NewNop())
	var calls atomic.Int32
	s.RegisterMethod("hard.count", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		calls.Add(1)
		return &pb.Error{Message: "ok"}, nil
	})
	cases := []struct {
		name    string
		headers []hardHeader
		reject  bool
	}{
		{"MaxHeaders entries", hardHeaders(MaxHeaders), false},
		{"MaxHeaders+1 entries", hardHeaders(MaxHeaders + 1), true},
		{"MaxHeaderBytes", []hardHeader{hardHeaderOfSize(t, MaxHeaderBytes)}, false},
		{"MaxHeaderBytes+1", []hardHeader{hardHeaderOfSize(t, MaxHeaderBytes+1)}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			frame := hardFrame(t, &pb.Call{Id: 3, Method: "hard.count", Argument: hardArg(t)}, tc.headers...)
			body := append(binary.AppendUvarint(nil, uint64(len(frame))), frame...)
			before := calls.Load()
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("POST", "/", bytes.NewReader(body)))
			if tc.reject {
				if w.Code != http.StatusBadRequest || w.Body.String() != "rpc: too many headers" || calls.Load() != before {
					t.Fatalf("got %d %q, handler ran %d times; want 400 \"rpc: too many headers\", not run", w.Code, w.Body.String(), calls.Load()-before)
				}
				return
			}
			if w.Code != http.StatusOK || calls.Load() != before+1 {
				t.Fatalf("got %d %q, handler ran %d times; want 200, run once", w.Code, w.Body.String(), calls.Load()-before)
			}
		})
	}
}

// A frame of 80k headers is rejected without decoding them.
func TestHardHeaderCapNoAmplification(t *testing.T) {
	frame := hardFrame(t, &pb.Call{Id: 9, Method: "hard.count", Argument: hardArg(t)}, hardHeaders(80000)...)

	t.Run("rw", func(t *testing.T) {
		disp, calls := hardCounter("hard.count")
		tr, err := (&RWDialer{ReadWriter: hardDiscardRW{}}).Dial(context.Background(), disp)
		if err != nil {
			t.Fatal(err)
		}
		rw := tr.(*RWTransport)
		allocs := testing.AllocsPerRun(10, func() {
			if err := rw.dispatch(frame); err != nil {
				t.Fatal(err)
			}
		})
		t.Logf("%d-byte frame: %v allocations", len(frame), allocs)
		if allocs > 50 {
			t.Errorf("dispatching the frame allocated %v times", allocs)
		}
		if calls.Load() != 0 {
			t.Errorf("frame was dispatched")
		}
		select {
		case r := <-rw.rejections:
			if r.id != 9 || !errors.Is(r.err, ErrTooManyHeaders) {
				t.Errorf("queued rejection %+v", r)
			}
		default:
			t.Errorf("no rejection queued")
		}
	})

	t.Run("http", func(t *testing.T) {
		s := NewHTTPServer(zap.NewNop())
		s.MaxMessageBytes = 2 << 20
		body := append(binary.AppendUvarint(nil, uint64(len(frame))), frame...)
		var w *httptest.ResponseRecorder
		allocs := testing.AllocsPerRun(10, func() {
			w = httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("POST", "/", bytes.NewReader(body)))
		})
		if w.Code != http.StatusBadRequest || w.Body.String() != "rpc: too many headers" {
			t.Fatalf("got %d %q, want 400 \"rpc: too many headers\"", w.Code, w.Body.String())
		}
		t.Logf("%d-byte frame: %v allocations", len(frame), allocs)
		if allocs > 200 {
			t.Errorf("serving the frame allocated %v times", allocs)
		}
	})
}

// Rejections are sent without blocking the read loop, dropped when they
// back up, and their sender stops with the transport.
func TestHardRejectionQueue(t *testing.T) {
	const fn = "rpc.(*RWTransport).sendRejections"
	before := hardGoroutines(fn)

	core, logs := observer.New(zap.WarnLevel)
	entered := make(chan struct{})
	disp := NewServiceDispatcher(zap.NewNop())
	disp.RegisterMethod("hard.enter", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	})
	// The peer never reads, so the transport's writes block once the pipe is
	// full.
	p := hardServe(t, disp, func(d *RWDialer) { d.Logger = zap.New(core) })

	go func() {
		over := hardHeaders(MaxHeaders + 1)
		for i := range 5000 {
			frame := hardFrame(t, &pb.Call{Id: uint64(i + 1), Method: "hard.enter"}, over...)
			if _, err := p.rw.Write(append(binary.AppendUvarint(nil, uint64(len(frame))), frame...)); err != nil {
				return
			}
		}
		frame := hardFrame(t, &pb.Call{Id: 1 << 20, Method: "hard.enter", Argument: hardArg(t)})
		p.rw.Write(append(binary.AppendUvarint(nil, uint64(len(frame))), frame...))
	}()
	cliWaitClosed(t, entered, 5*time.Second, "request after 5000 rejections was not dispatched")
	if logs.FilterMessage("rpc transport dropped rejection").Len() == 0 {
		t.Error("no rejection was dropped")
	}

	p.stop()
	cliWaitErr(t, p.done, time.Second, "Listen")
	if !cliEventually(2*time.Second, func() bool { return hardGoroutines(fn) <= before }) {
		t.Fatalf("%d rejection senders running, %d before", hardGoroutines(fn), before)
	}
}

// hardCapture is a Dialer that hands the transports it dials to dialed.
type hardCapture struct {
	*RWDialer
	dialed chan *RWTransport
}

func (d hardCapture) Dial(ctx context.Context, dispatcher Dispatcher) (Transport, error) {
	tr, err := d.RWDialer.Dial(ctx, dispatcher)
	if err == nil {
		d.dialed <- tr.(*RWTransport)
	}
	return tr, err
}

// hardConn connects a Client made with clientOpts to a Server made with
// serverOpts over a pipe pair.
func hardConn(t *testing.T, register func(*ServiceDispatcher), serverOpts []Option, dialer func(*RWDialer), clientOpts ...Option) *Client {
	t.Helper()
	c, _ := hardConnServer(t, register, serverOpts, dialer, clientOpts...)
	return c
}

// hardConnServer is hardConn that also returns the server's transport.
func hardConnServer(t *testing.T, register func(*ServiceDispatcher), serverOpts []Option, dialer func(*RWDialer), clientOpts ...Option) (*Client, *RWTransport) {
	t.Helper()
	logger := zap.NewNop()
	clientRW, serverRW := cliNewPipePair(t)

	d := hardCapture{&RWDialer{Logger: logger, ReadWriter: serverRW}, make(chan *RWTransport, 1)}
	if dialer != nil {
		dialer(d.RWDialer)
	}
	s := NewServer(logger, d, serverOpts...)
	register(s.ServiceDispatcher)
	ctx, cancel := context.WithCancel(context.Background())
	go s.Listen(ctx)
	st := <-d.dialed

	c, err := NewClient(logger, &RWDialer{Logger: logger, ReadWriter: clientRW}, clientOpts...)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		c.Close()
		cancel()
	})
	return c, st
}

// hardNested returns a message nested depth levels deep, itself included.
func hardNested(depth int) *descriptorpb.DescriptorProto {
	m := &descriptorpb.DescriptorProto{}
	for cur := m; depth > 1; depth-- {
		next := &descriptorpb.DescriptorProto{}
		cur.NestedType = []*descriptorpb.DescriptorProto{next}
		cur = next
	}
	return m
}

// hardNester registers hard.depth, which accepts any nesting and replies
// with the nesting its request's Code asks for.
func hardNester(d *ServiceDispatcher) {
	d.RegisterMethod("hard.depth", func(ctx context.Context, req *descriptorpb.DescriptorProto) (*pb.Error, error) {
		return &pb.Error{Message: "ok"}, nil
	})
	d.RegisterMethod("hard.deep", func(ctx context.Context, req *pb.Error) (*descriptorpb.DescriptorProto, error) {
		return hardNested(int(req.Code)), nil
	})
	d.RegisterMethod("hard.deepstream", func(ctx context.Context, req *pb.Error) (<-chan *descriptorpb.DescriptorProto, error) {
		ch := make(chan *descriptorpb.DescriptorProto, 1)
		ch <- hardNested(int(req.Code))
		close(ch)
		return ch, nil
	})
}

// hardDepthError is in protobuf-go's error for nesting over the limit.
const hardDepthError = "exceeded maximum recursion depth"

func hardCallTimeout(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// The default decoder accepts nesting up to 100 deep, on servers and
// clients.
func TestHardRecursionDefault(t *testing.T) {
	c := hardConn(t, hardNester, nil, nil)

	t.Run("argument", func(t *testing.T) {
		if err := c.CallUnary(hardCallTimeout(t), "hard.depth", hardNested(100), &pb.Error{}); err != nil {
			t.Fatalf("depth 100: %v", err)
		}
		var e *pb.Error
		if err := c.CallUnary(hardCallTimeout(t), "hard.depth", hardNested(101), &pb.Error{}); !errors.As(err, &e) || !strings.Contains(e.Message, hardDepthError) {
			t.Fatalf("depth 101: got %v, want an ERROR response containing %q", err, hardDepthError)
		}
	})

	t.Run("response", func(t *testing.T) {
		if err := c.CallUnary(hardCallTimeout(t), "hard.deep", &pb.Error{Code: 100}, &descriptorpb.DescriptorProto{}); err != nil {
			t.Fatalf("depth 100: %v", err)
		}
		if err := c.CallUnary(hardCallTimeout(t), "hard.deep", &pb.Error{Code: 101}, &descriptorpb.DescriptorProto{}); err == nil || !strings.Contains(err.Error(), hardDepthError) {
			t.Fatalf("depth 101: got %v, want %q", err, hardDepthError)
		}
		ch := make(chan *descriptorpb.DescriptorProto, 1)
		if err := c.CallStreaming(hardCallTimeout(t), "hard.deepstream", &pb.Error{Code: 101}, ch); err == nil || !strings.Contains(err.Error(), hardDepthError) {
			t.Fatalf("stream of depth 101: got %v, want %q", err, hardDepthError)
		}
	})

	t.Run("http", func(t *testing.T) {
		s := NewHTTPServer(zap.NewNop())
		hardNester(s.ServiceDispatcher)
		for depth, wantKind := range map[int]pb.Call_Kind{100: pb.Call_CALL_KIND_DEFAULT, 101: pb.Call_CALL_KIND_ERROR} {
			w := httptest.NewRecorder()
			s.ServeHTTP(w, srvHTTPRequest(t, context.Background(), &pb.Call{Id: 1, Method: "hard.depth", Argument: srvMarshal(t, hardNested(depth))}))
			if res := srvHTTPDecode(t, w.Body.Bytes()); res.Kind != wantKind {
				t.Errorf("depth %d: got %v, want %v", depth, res.Kind, wantKind)
			}
		}
	})

	t.Run("CallIn.Argument", func(t *testing.T) {
		for depth, ok := range map[int]bool{100: true, 101: false} {
			call := NewCallIn(context.Background(), &pb.Call{Argument: srvMarshal(t, hardNested(depth))}, noopParentCallAccessor{}, nil)
			if err := call.Argument(&descriptorpb.DescriptorProto{}); (err == nil) != ok {
				t.Errorf("depth %d: got %v", depth, err)
			}
		}
	})
}

// hardRecorder is an UnmarshalFunc that records what it decodes and fails
// for messages whose bytes equal fail.
type hardRecorder struct {
	calls atomic.Int32
	last  atomic.Pointer[[]byte]
	fail  []byte
}

var errHardUnmarshal = errors.New("hard: unmarshal refused")

func (r *hardRecorder) unmarshal(b []byte, m proto.Message) error {
	r.calls.Add(1)
	b = bytes.Clone(b)
	r.last.Store(&b)
	if r.fail != nil && bytes.Equal(b, r.fail) {
		return errHardUnmarshal
	}
	return proto.UnmarshalOptions{RecursionLimit: 1000}.Unmarshal(b, m)
}

// WithUnmarshal replaces the default decoder on servers, HTTP servers and
// clients.
func TestHardUnmarshalHook(t *testing.T) {
	refuse := &pb.Error{Message: "refuse"}

	t.Run("server", func(t *testing.T) {
		hook := &hardRecorder{fail: srvMarshal(t, refuse)}
		c := hardConn(t, func(d *ServiceDispatcher) {
			hardNester(d)
			d.RegisterMethod("hard.echo", func(ctx context.Context, req *pb.Error) (*pb.Error, error) { return req, nil })
		}, []Option{WithUnmarshal(hook.unmarshal)}, nil)

		if err := c.CallUnary(hardCallTimeout(t), "hard.depth", hardNested(200), &pb.Error{}); err != nil {
			t.Fatalf("depth 200 with the hook: %v", err)
		}
		if got, want := *hook.last.Load(), srvMarshal(t, hardNested(200)); !bytes.Equal(got, want) {
			t.Fatalf("hook got %x, want the argument %x", got, want)
		}
		var e *pb.Error
		if err := c.CallUnary(hardCallTimeout(t), "hard.echo", refuse, &pb.Error{}); !errors.As(err, &e) || e.Message != errHardUnmarshal.Error() {
			t.Fatalf("got %v, want the hook's error", err)
		}
	})

	t.Run("client", func(t *testing.T) {
		hook := &hardRecorder{fail: srvMarshal(t, &pb.Error{Message: "ok"})}
		c := hardConn(t, hardNester, nil, nil, WithUnmarshal(hook.unmarshal))

		if err := c.CallUnary(hardCallTimeout(t), "hard.deep", &pb.Error{Code: 200}, &descriptorpb.DescriptorProto{}); err != nil {
			t.Fatalf("depth 200 with the hook: %v", err)
		}
		if got, want := *hook.last.Load(), srvMarshal(t, hardNested(200)); !bytes.Equal(got, want) {
			t.Fatalf("hook got %x, want the response %x", got, want)
		}
		if err := c.CallUnary(hardCallTimeout(t), "hard.depth", &descriptorpb.DescriptorProto{}, &pb.Error{}); !errors.Is(err, errHardUnmarshal) {
			t.Fatalf("got %v, want the hook's error", err)
		}

		ch := make(chan *descriptorpb.DescriptorProto, 1)
		if err := c.CallStreaming(hardCallTimeout(t), "hard.deepstream", &pb.Error{Code: 200}, ch); err != nil {
			t.Fatalf("stream of depth 200 with the hook: %v", err)
		}
		if len(ch) != 1 {
			t.Fatalf("stream delivered %d messages, want 1", len(ch))
		}
	})

	t.Run("http", func(t *testing.T) {
		hook := &hardRecorder{}
		s := NewHTTPServer(zap.NewNop(), WithUnmarshal(hook.unmarshal))
		hardNester(s.ServiceDispatcher)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, srvHTTPRequest(t, context.Background(), &pb.Call{Id: 1, Method: "hard.depth", Argument: srvMarshal(t, hardNested(200))}))
		if res := srvHTTPDecode(t, w.Body.Bytes()); res.Kind != pb.Call_CALL_KIND_DEFAULT || hook.calls.Load() != 1 {
			t.Fatalf("got %v after %d hook calls, want DEFAULT after 1", res.Kind, hook.calls.Load())
		}
	})

	t.Run("nil", func(t *testing.T) {
		c := hardConn(t, hardNester, []Option{WithUnmarshal(nil), nil}, nil, WithUnmarshal(nil))
		if err := c.CallUnary(hardCallTimeout(t), "hard.depth", hardNested(101), &pb.Error{}); err == nil {
			t.Fatal("depth 101 accepted with WithUnmarshal(nil)")
		}
		if err := c.CallUnary(hardCallTimeout(t), "hard.deep", &pb.Error{Code: 101}, &descriptorpb.DescriptorProto{}); err == nil {
			t.Fatal("depth 101 response accepted with WithUnmarshal(nil)")
		}
	})
}

// hardHolder is a Dispatcher that keeps hard.hold calls in service until
// released and finishes every other frame at once. It records the methods
// it sees.
type hardHolder struct {
	mu   sync.Mutex
	held []func()
	seen []string
}

func (h *hardHolder) Dispatch(call *CallIn, done func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.seen = append(h.seen, call.Method())
	if call.Method() == "hard.hold" {
		h.held = append(h.held, done)
		return
	}
	done()
}

// releaseOne finishes the oldest held call, calling its done twice.
func (h *hardHolder) releaseOne() {
	h.mu.Lock()
	done := h.held[0]
	h.held = h.held[1:]
	h.mu.Unlock()
	done()
	done()
}

func (h *hardHolder) count(method string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	for _, m := range h.seen {
		if m == method {
			n++
		}
	}
	return n
}

const hardTooManyCalls = "rpc: too many concurrent calls"

func hardCallCap(n int) func(*RWDialer) {
	return func(d *RWDialer) { d.MaxConcurrentCalls = n }
}

// Over the limit, requests get an ERROR at once and their handlers never
// run.
func TestHardCallCapRejects(t *testing.T) {
	entered := make(chan struct{}, 3)
	c := hardConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("hard.block", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
			entered <- struct{}{}
			<-ctx.Done()
			return nil, ctx.Err()
		})
	}, nil, hardCallCap(2))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for range 2 {
		go c.CallUnary(ctx, "hard.block", &pb.Error{}, &pb.Error{})
		cliWaitClosed(t, entered, 2*time.Second, "call not served")
	}

	start := time.Now()
	err := c.CallUnary(hardCallTimeout(t), "hard.block", &pb.Error{}, &pb.Error{})
	var e *pb.Error
	if !errors.As(err, &e) || e.Message != hardTooManyCalls || ErrorCode(err) != 1003 {
		t.Fatalf("got %v (code %d), want %q with code 1003", err, ErrorCode(err), hardTooManyCalls)
	}
	if d := time.Since(start); d > time.Second {
		t.Fatalf("rejection took %s", d)
	}
	select {
	case <-entered:
		t.Fatal("rejected call reached its handler")
	case <-time.After(50 * time.Millisecond):
	}
}

// A call's slot is released when it returns, when its stream closes and
// when it is cancelled, by a CANCEL that is processed even at the limit.
func TestHardCallCapRelease(t *testing.T) {
	c, st := hardConnServer(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("hard.unary", cliUnary)
		d.RegisterMethod("hard.block", cliBlock(nil))
		d.RegisterMethod("hard.stream", cliStreamer(3, 0, nil))
		d.RegisterMethod("hard.silent", cliSilentStream)
	}, nil, hardCallCap(1))

	waitInService := func(t *testing.T, n int64, what string) {
		t.Helper()
		if !cliEventually(2*time.Second, func() bool { return st.inService.n.Load() == n }) {
			t.Fatalf("%d calls in service, want %d %s", st.inService.n.Load(), n, what)
		}
	}
	unary := func() error { return c.CallUnary(hardCallTimeout(t), "hard.unary", &pb.Error{}, &pb.Error{}) }

	t.Run("unary", func(t *testing.T) {
		for range 3 {
			if err := unary(); err != nil {
				t.Fatal(err)
			}
			waitInService(t, 0, "after a unary call returned")
		}
	})

	t.Run("stream close", func(t *testing.T) {
		ch := make(chan *pb.Error, 3)
		if err := c.CallStreaming(hardCallTimeout(t), "hard.stream", &pb.Error{}, ch); err != nil {
			t.Fatal(err)
		}
		waitInService(t, 0, "after a stream closed")
	})

	cancelled := func(t *testing.T, call func(ctx context.Context) error) {
		ctx, cancel := context.WithCancel(context.Background())
		errc := make(chan error, 1)
		go func() { errc <- call(ctx) }()
		waitInService(t, 1, "while a call is blocked")
		if err := unary(); ErrorCode(err) != 1003 {
			t.Fatalf("call at the limit returned %v, want code 1003", err)
		}
		cancel()
		cliWaitErr(t, errc, 2*time.Second, "call")
		waitInService(t, 0, "after its CANCEL")
		if err := unary(); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("unary cancel", func(t *testing.T) {
		cancelled(t, func(ctx context.Context) error {
			return c.CallUnary(ctx, "hard.block", &pb.Error{}, &pb.Error{})
		})
	})

	t.Run("stream cancel", func(t *testing.T) {
		cancelled(t, func(ctx context.Context) error {
			return c.CallStreaming(ctx, "hard.silent", &pb.Error{}, make(chan *pb.Error))
		})
	})
}

// At the limit, CALLBACK frames are dropped without a reply, CANCEL frames
// are dispatched, and calling done twice releases one slot.
func TestHardCallCapFrames(t *testing.T) {
	h := &hardHolder{}
	p := hardServe(t, h, hardCallCap(1))
	p.startReading()

	p.write(t, hardFrame(t, &pb.Call{Id: 1, Method: "hard.hold"}))
	p.write(t, hardFrame(t, &pb.Call{Id: 2, ParentId: 99, Method: callbackMethod}))
	p.write(t, hardFrame(t, &pb.Call{Id: 3, Method: "hard.other"}))
	hardWantError(t, p.next(t), 3, hardTooManyCalls, 1003)
	if n := h.count(callbackMethod); n != 0 {
		t.Fatalf("CALLBACK over the limit was dispatched")
	}

	p.write(t, hardFrame(t, &pb.Call{Id: 4, ParentId: 1, Method: cancelMethod}))
	if !cliEventually(time.Second, func() bool { return h.count(cancelMethod) == 1 }) {
		t.Fatal("CANCEL at the limit was not dispatched")
	}

	h.releaseOne()
	p.write(t, hardFrame(t, &pb.Call{Id: 5, Method: "hard.hold"}))
	p.write(t, hardFrame(t, &pb.Call{Id: 6, Method: "hard.other"}))
	hardWantError(t, p.next(t), 6, hardTooManyCalls, 1003)
	if n := h.count("hard.hold"); n != 2 {
		t.Fatalf("dispatched %d hard.hold calls, want 2", n)
	}
}

// The limit is per transport, even when transports share a dispatcher.
func TestHardCallCapPerTransport(t *testing.T) {
	entered := make(chan struct{}, 1)
	disp := NewServiceDispatcher(zap.NewNop())
	disp.RegisterMethod("hard.block", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		entered <- struct{}{}
		<-ctx.Done()
		return nil, ctx.Err()
	})
	disp.RegisterMethod("hard.unary", cliUnary)
	a := hardServe(t, disp, hardCallCap(1))
	b := hardServe(t, disp, hardCallCap(1))
	a.startReading()
	b.startReading()

	a.write(t, hardFrame(t, &pb.Call{Id: 1, Method: "hard.block", Argument: hardArg(t)}))
	cliWaitClosed(t, entered, 2*time.Second, "call not served")
	a.write(t, hardFrame(t, &pb.Call{Id: 2, Method: "hard.unary", Argument: hardArg(t)}))
	hardWantError(t, a.next(t), 2, hardTooManyCalls, 1003)

	b.write(t, hardFrame(t, &pb.Call{Id: 1, Method: "hard.unary", Argument: hardArg(t)}))
	if res := b.next(t); res.ParentId != 1 || res.Kind != pb.Call_CALL_KIND_DEFAULT {
		t.Fatalf("other transport: got %v response to %d, want DEFAULT to 1", res.Kind, res.ParentId)
	}
}

// HTTPServer limits requests across clients, answers over the limit with an
// ERROR frame, doesn't limit CANCEL, and counts a handler until it returns,
// even after its client has gone.
func TestHardCallCapHTTP(t *testing.T) {
	s := NewHTTPServer(zap.NewNop())
	s.MaxConcurrentCalls = 1
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	s.RegisterMethod("hard.block", func(ctx context.Context, req *pb.Error) (*pb.Error, error) {
		entered <- struct{}{}
		<-release
		return &pb.Error{}, nil
	})
	s.RegisterMethod("hard.unary", cliUnary)
	serve := func(ctx context.Context, c *pb.Call) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		s.ServeHTTP(w, srvHTTPRequest(t, ctx, c))
		return w
	}
	unary := func(id uint64) *pb.Call {
		return srvHTTPDecode(t, serve(context.Background(), &pb.Call{Id: id, Method: "hard.unary", Argument: hardArg(t)}).Body.Bytes())
	}

	ctx, cancel := context.WithCancel(context.Background())
	served := make(chan struct{})
	go func() {
		serve(ctx, &pb.Call{Id: 1, Method: "hard.block", Argument: hardArg(t)})
		close(served)
	}()
	cliWaitClosed(t, entered, 2*time.Second, "call not served")

	hardWantError(t, unary(2), 2, hardTooManyCalls, 1003)
	if w := serve(context.Background(), &pb.Call{Id: 3, ParentId: 1, Method: cancelMethod}); w.Code != http.StatusOK || w.Body.Len() != 0 {
		t.Fatalf("CANCEL at the limit: got %d with %d bytes, want an empty 200", w.Code, w.Body.Len())
	}

	cancel()
	cliWaitClosed(t, served, 2*time.Second, "ServeHTTP did not return after the client went away")
	hardWantError(t, unary(4), 4, hardTooManyCalls, 1003)

	close(release)
	if !cliEventually(2*time.Second, func() bool { return unary(5).Kind == pb.Call_CALL_KIND_DEFAULT }) {
		t.Fatal("slot not released after the handler returned")
	}
}

// The limit errors carry strims-rpc's codes, and wrapping keeps them.
func TestHardErrorCodes(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code int32
	}{
		{ErrTooManyCalls, 1003},
		{ErrStreamBufferFull, 1010},
		{ErrTooManyHeaders, 0},
		{ErrMessageTooLarge, 0},
	} {
		wrapped := fmt.Errorf("wrapped: %w", tc.err)
		if ErrorCode(tc.err) != tc.code || ErrorCode(wrapped) != tc.code || !errors.Is(wrapped, tc.err) {
			t.Errorf("%v: code %d (wrapped %d, matches %v), want %d", tc.err, ErrorCode(tc.err), ErrorCode(wrapped), errors.Is(wrapped, tc.err), tc.code)
		}
	}

	// A call that overflows its buffer fails with code 1010.
	c := cliNewConn(t, func(d *ServiceDispatcher) {
		d.RegisterMethod("hard.stream", cliStreamer(-1, 0, nil))
	}, func(d *RWDialer) {
		d.MaxStreamBufferBytes = 1
	})
	err := c.client.CallStreaming(hardCallTimeout(t), "hard.stream", &pb.Error{}, make(chan *pb.Error))
	if !errors.Is(err, ErrStreamBufferFull) || ErrorCode(err) != 1010 {
		t.Fatalf("got %v (code %d), want ErrStreamBufferFull with code 1010", err, ErrorCode(err))
	}
}

// 0 means 128 calls and negative means unlimited.
func TestHardCallCapDefaults(t *testing.T) {
	for n, want := range map[int]int{0: 128, 5: 5, -1: -1} {
		if got := concurrentCallLimit(n); got != want {
			t.Errorf("concurrentCallLimit(%d) = %d, want %d", n, got, want)
		}
	}

	t.Run("default", func(t *testing.T) {
		h := &hardHolder{}
		p := hardServe(t, h, nil)
		p.startReading()
		for i := range 128 {
			p.write(t, hardFrame(t, &pb.Call{Id: uint64(i + 1), Method: "hard.hold"}))
		}
		p.write(t, hardFrame(t, &pb.Call{Id: 1000, Method: "hard.other"}))
		hardWantError(t, p.next(t), 1000, hardTooManyCalls, 1003)
		if n := h.count("hard.hold"); n != 128 {
			t.Fatalf("held %d calls, want 128", n)
		}
	})

	t.Run("unlimited", func(t *testing.T) {
		h := &hardHolder{}
		p := hardServe(t, h, hardCallCap(-1))
		for i := range 1000 {
			p.write(t, hardFrame(t, &pb.Call{Id: uint64(i + 1), Method: "hard.hold"}))
		}
		p.write(t, hardFrame(t, &pb.Call{Id: 2000, Method: "hard.other"}))
		if !cliEventually(2*time.Second, func() bool { return h.count("hard.other") == 1 }) {
			t.Fatalf("request after %d held calls was not dispatched", h.count("hard.hold"))
		}
	})
}

// Negative MaxMessageBytes means unlimited, and a frame's memory is
// allocated as its bytes arrive rather than as its length prefix claims.
func TestHardMessageBytesUnlimited(t *testing.T) {
	big := &pb.Call{Id: 1, Method: "hard.count", Argument: srvMarshal(t, &pb.Error{Message: strings.Repeat("x", 600<<10)})}

	t.Run("rw", func(t *testing.T) {
		disp, _ := hardCounter("hard.count")
		unlimited := func(d *RWDialer) { d.MaxMessageBytes = -1 }

		p := hardServe(t, disp, unlimited)
		p.startReading()
		p.write(t, hardFrame(t, big))
		if res := p.next(t); res.ParentId != 1 || res.Kind != pb.Call_CALL_KIND_DEFAULT {
			t.Fatalf("got %v response to %d, want DEFAULT to 1", res.Kind, res.ParentId)
		}
		if n := p.tr.maxStreamBufferBytes; n != defaultMinStreamBufferBytes {
			t.Errorf("default MaxStreamBufferBytes with unlimited messages is %d, want %d", n, defaultMinStreamBufferBytes)
		}

		q := hardServe(t, disp, unlimited)
		if _, err := q.rw.Write(append(binary.AppendUvarint(nil, 1<<50), make([]byte, 32)...)); err != nil {
			t.Fatal(err)
		}
		q.rw.Close()
		if err := cliWaitErr(t, q.done, 2*time.Second, "Listen"); !errors.Is(err, io.ErrUnexpectedEOF) {
			t.Fatalf("Listen returned %v, want io.ErrUnexpectedEOF", err)
		}
	})

	t.Run("http", func(t *testing.T) {
		s := NewHTTPServer(zap.NewNop())
		s.MaxMessageBytes = -1
		s.RegisterMethod("hard.count", cliUnary)
		serve := func(body []byte) *httptest.ResponseRecorder {
			w := httptest.NewRecorder()
			s.ServeHTTP(w, httptest.NewRequest("POST", "/", bytes.NewReader(body)))
			return w
		}

		body, err := marshalAppendLengthDelimited(nil, big)
		if err != nil {
			t.Fatal(err)
		}
		if w := serve(body); w.Code != http.StatusOK || srvHTTPDecode(t, w.Body.Bytes()).Kind != pb.Call_CALL_KIND_DEFAULT {
			t.Fatalf("600 KiB request: got %d, want a DEFAULT response", w.Code)
		}
		if w := serve(append(binary.AppendUvarint(nil, 1<<50), make([]byte, 32)...)); w.Code != http.StatusBadRequest {
			t.Fatalf("truncated 1 PiB request: got %d, want 400", w.Code)
		}
		if w := serve(append(binary.AppendUvarint(nil, 1<<63), make([]byte, 32)...)); w.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("request longer than an int: got %d, want 413", w.Code)
		}
	})
}
