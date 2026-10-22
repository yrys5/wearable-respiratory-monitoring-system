#include "reliable_ble.h"
#include <string.h>
#include <limits.h>

typedef struct { uint8_t wire[20]; uint32_t last_sent; } Slot;
static Slot queue[RBL_CAPACITY];
static uint32_t session, produced, acknowledged, highest_sent, last_attempt;
static uint16_t head, count;
static uint8_t flags, error_code, last_command;
RBL_Stats rbl_stats;

static uint32_t get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static void put32(uint8_t *p, uint32_t n) {
    p[0]=(uint8_t)n; p[1]=(uint8_t)(n>>8);
    p[2]=(uint8_t)(n>>16); p[3]=(uint8_t)(n>>24);
}
static Slot *slot_for(uint32_t sequence) {
    return &queue[(head + (sequence - acknowledged - 1u)) % RBL_CAPACITY];
}
static void reject(uint8_t code) {
    error_code=code; rbl_stats.invalid_commands++;
}
static void acknowledge(uint32_t sequence) {
    uint32_t delta=sequence-acknowledged;
    head=(uint16_t)((head+delta)%RBL_CAPACITY);
    count=(uint16_t)(count-delta);
    acknowledged=sequence;
}
void RBL_Init(void) {
    memset(queue,0,sizeof(queue)); memset(&rbl_stats,0,sizeof(rbl_stats));
    session=produced=acknowledged=highest_sent=last_attempt=0;
    head=count=0; flags=error_code=last_command=0;
}
void RBL_SetConnected(uint8_t connected) {
    flags &= (uint8_t)~(RBL_CONNECTED|RBL_SUBSCRIBED|RBL_READY);
    if(connected) flags|=RBL_CONNECTED;
}
void RBL_SetSubscribed(uint8_t subscribed) {
    flags &= (uint8_t)~(RBL_SUBSCRIBED|RBL_READY);
    if(subscribed) flags|=RBL_SUBSCRIBED;
}
void RBL_Control(const uint8_t *p, uint16_t length, uint32_t now) {
    uint32_t id, seq;
    error_code=0; last_command=length ? p[0] : 0;
    if(length!=9) { reject(1); return; }
    id=get32(p+1); seq=get32(p+5);
    if(!(flags&RBL_CONNECTED)) { reject(6); return; }
    if(p[0]==RBL_CMD_START) {
        if(!id || seq || !(flags&RBL_SUBSCRIBED)) { reject(1); return; }
        if(id==session) return;
        if((flags&RBL_ACTIVE) || count) { reject(2); return; }
        session=id; produced=acknowledged=highest_sent=0; head=count=0;
        flags=(flags&(RBL_CONNECTED|RBL_SUBSCRIBED))|RBL_ACTIVE|RBL_READY;
        memset(&rbl_stats,0,sizeof(rbl_stats));
        last_attempt=now-RBL_PACE_MS;
        return;
    }
    if(!session || id!=session) { reject(3); return; }
    if(p[0]==RBL_CMD_STOP) {
        if(seq) { reject(1); return; }
        flags &= (uint8_t)~RBL_ACTIVE;
        return;
    }
    if(p[0]!=RBL_CMD_ACK && p[0]!=RBL_CMD_RESUME) { reject(1); return; }
    if(seq>highest_sent) { reject(4); return; }
    if(p[0]==RBL_CMD_ACK) {
        if(seq>acknowledged) acknowledge(seq);
        return;
    }
    if(!(flags&RBL_SUBSCRIBED)) { reject(6); return; }
    if(seq<acknowledged) { reject(5); return; }
    acknowledge(seq);
    flags |= RBL_READY;
    for(uint32_t offset=1; offset<=highest_sent-acknowledged; ++offset)
        slot_for(acknowledged+offset)->last_sent=now-RBL_TIMEOUT_MS;
    last_attempt=now-RBL_PACE_MS;
}
int RBL_Queue(int32_t ch1, int32_t ch2, uint32_t timestamp) {
    Slot *s;
    if(!(flags&RBL_ACTIVE)) return 0;
    if(count==RBL_CAPACITY || produced==UINT32_MAX) {
        flags |= count==RBL_CAPACITY ? RBL_OVERFLOW : RBL_SEQUENCE_LIMIT;
        flags &= (uint8_t)~RBL_ACTIVE;
        return -1;
    }
    s=&queue[(head+count)%RBL_CAPACITY];
    produced++;
    put32(s->wire,(uint32_t)ch1); put32(s->wire+4,(uint32_t)ch2);
    put32(s->wire+8,produced); put32(s->wire+12,timestamp);
    put32(s->wire+16,session); s->last_sent=0;
    count++; if(count>rbl_stats.max_queued) rbl_stats.max_queued=count;
    return 1;
}
void RBL_AdcGap(void) {
    if(flags&RBL_ACTIVE) { flags|=RBL_ADC_GAP; rbl_stats.adc_gaps++; }
}
void RBL_GetStatus(uint8_t p[20]) {
    memset(p,0,20); p[0]=1; p[1]=flags;
    p[2]=(uint8_t)count; p[3]=(uint8_t)(count>>8);
    put32(p+4,session); put32(p+8,produced); put32(p+12,acknowledged);
    p[16]=error_code; p[17]=last_command;
}
void RBL_Process(uint32_t now, RBL_SendFn send) {
    const uint8_t required=RBL_CONNECTED|RBL_SUBSCRIBED|RBL_READY;
    uint32_t candidate=0, outstanding=highest_sent-acknowledged;
    if((flags&required)!=required || !count ||
       (uint32_t)(now-last_attempt)<RBL_PACE_MS) return;
    for(uint32_t offset=1; offset<=outstanding; ++offset) {
        uint32_t seq=acknowledged+offset;
        if((uint32_t)(now-slot_for(seq)->last_sent)>=RBL_TIMEOUT_MS) {
            candidate=seq; break;
        }
    }
    if(!candidate && outstanding<RBL_WINDOW && highest_sent<produced)
        candidate=highest_sent+1u;
    if(!candidate) return;
    Slot *s=slot_for(candidate);
    last_attempt=now;
    if(send(s->wire)!=0) { rbl_stats.send_errors++; return; }
    if(candidate<=highest_sent) rbl_stats.retries++;
    else highest_sent=candidate;
    s->last_sent=now; rbl_stats.sent++;
}
