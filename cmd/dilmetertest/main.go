package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/irusan-fanclub/mogugi/lib/packet"
	"github.com/irusan-fanclub/mogugi/lib/pcaputil"
)

var logger = log.New(os.Stdout, "dilmeter ", log.LstdFlags|log.Lshortfile)

func main() {
	nicName := ""

	if len(os.Args) > 1 {
		nicName = os.Args[1]
	}

	if nicName == "" {
		_nicName, err := pcaputil.FindNic()
		if err != nil {
			logger.Fatalln("FindNic failed:", err)
		}

		nicName = _nicName
	}

	logger.Println("nicName:", nicName)

	entityMap := make(map[uint64]*packet.EntityInfo)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx:     ctx,
		NicName: nicName,
	})

	if err != nil {
		logger.Fatalln("NewGameServerPacketReader failed:", err)
	}

	for p := range r.PacketCh() {
		switch p.Op {
		// short packet
		case 0:
			continue

		case packet.OpcodeEntityAppear:
			entity, err := packet.ParseEntityAppearPacket(p.Msg)
			if err != nil {
				logger.Println("ParseEntityAppearPacket failed:", err)
				continue
			}
			if entity != nil {
				entityMap[entity.Id] = entity
			}
			continue

		case packet.OpcodeEntitiesAppear:
			entities, err := packet.ParseEntitiesAppearPacket(p)
			if err != nil {
				logger.Println("ParseEntitiesAppearPacket failed:", err)
				continue
			}
			for _, entity := range entities {
				entityMap[entity.Id] = entity
			}
			continue

		case packet.OpcodeCombatAction:
			pack, err := packet.ParseCombatActionPackPacket(p)
			if err != nil {
				logger.Println("ParseCombatActionPackPacket failed:", err)
				continue
			}

			attackerName := ""
			attackSkillId := uint16(0)
			targetName := ""
			damage := float32(0)

			for _, v := range pack.SubPackets {
				if v.Hit == nil {
					attackerName = fmt.Sprintf("entityId:%x", v.EntityId)
					if entity := entityMap[v.EntityId]; entity != nil {
						attackerName = entity.Name
					}
					attackSkillId = v.SkillId
				} else {
					targetName = fmt.Sprintf("entityId:%x", v.EntityId)
					if entity := entityMap[v.EntityId]; entity != nil {
						targetName = entity.Name
					}
					damage = v.Hit.Damage
				}
			}

			logger.Println("*", attackerName, "->", targetName, "damage", damage, "skill", attackSkillId)
			continue

		// Known opcodes we intentionally ignore for this test tool.
		case packet.OpcodeEntityDisappear,
			packet.OpcodeCreatureBodyUpdate,
			packet.OpcodeItemAppear,
			packet.OpcodeItemDisappear,
			packet.OpcodeChat,
			packet.OpcodeNotice,
			packet.OpcodeUnknownWarp,
			packet.OpcodeEntitiesDisappear,
			packet.OpcodeIsNowDead,
			packet.OpcodeItemDurabilityUpdate,
			packet.OpcodeForceWalk,
			packet.OpcodeFlying,
			packet.OpcodeChangeStanceRes,
			packet.OpcodeChangeStance,
			packet.OpcodeStatUpdatePrivate,
			packet.OpcodeStatUpdatePublic,
			packet.OpcodeEntityRelated,
			packet.OpcodeCombatTargetUpdate,
			packet.OpcodeSetCombatTarget,
			packet.OpcodeSetFinisher,
			packet.OpcodeSetFinisher2,
			packet.OpcodeCombatAttackRes,
			packet.OpcodeEffect,
			packet.OpcodeEffectDelayed,
			packet.OpcodeCharacterConditionUpdate,
			packet.OpcodePartyWindowUpdate,
			packet.OpcodeWalking,
			packet.OpcodeRunning:
			continue
		}

		logger.Printf("packet op=%s id=%x", p.Op, p.Id)
		for i, msg := range p.Msg {
			logger.Println("* msg", i, msg.Type(), msg.String())
		}
	}
}
