package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"gitlab.com/prilus/mabidilmeter/packet"
	"gitlab.com/prilus/mabidilmeter/pcaputil"
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

		case 0x520c:
			// entity appears
			entity, err := packet.ParseEntityAppearPacket(p.Msg)
			if err != nil {
				logger.Println("ParseEntityAppearPacket failed:", err)
				continue
			}

			if entity != nil {
				entityMap[entity.Id] = entity
			}

			continue

		case 0x520d:
			// entity disappears
			// @TODO: Processing logic needed
			continue

		case 0x520e:
			// creature body update
			continue

		case 0x5211:
			// item appears
			continue

		case 0x5212:
			// item disappears
			continue

		case 0x526c:
			// chat
			continue

		case 0x526d:
			// notice
			continue

		case 0x526e:
			// unknown warp
			continue

		case 0x5334:
			// entities appear
			entities, err := packet.ParseEntitiesAppearPacket(p)
			if err != nil {
				logger.Println("ParseEntitiesAppearPacket failed:", err)
				continue
			}

			for _, entity := range entities {
				entityMap[entity.Id] = entity
			}
			continue

		case 0x5335:
			// entities disappear
			// @TODO: Processing logic needed
			continue

		case 0x53fc:
			// is now dead
			continue

		case 0x5bd5:
			// item durability update
			continue

		case 0x659b:
			// force walk
			continue

		case 0x65af:
			// flying
			continue

		case 0x6e29:
			// change stance res
			// My combat/normal mode change complete
			continue

		case 0x6e2a:
			// change stance
			// Combat/normal mode change
			continue

		case 0x7530:
			// stat update private
			// My status update
			continue

		case 0x7532:
			// stat update public
			continue

		case 0x7534:
			// entity related? lots of bytes
			continue

		case 0x791a:
			// combat target update
			// Reset sent when changing to normal mode
			continue

		case 0x7920:
			// set combat target
			// ?
			continue

		case 0x7921:
			// set finisher
			// id monster -> msg[0] finisher
			continue

		case 0x7922:
			// set finisher2
			continue

		case 0x7926:
			// combatactions
			pack, err := packet.ParseCombatActionPackPacket(p)
			if err != nil {
				logger.Println("ParseCombatActionPackPacket failed:", err)
				continue
			}

			attackerName := ""
			attackSkillId := uint16(0)
			targetName := ""
			damage := float32(0)

			for i, v := range pack.SubPackets {
				_ = i
				// logger.Println("sub packet", i, v.Hit != nil, v.Attacker != nil)
				// logger.Printf("base %+v", v)
				// if v.Hit != nil {
				// 	logger.Printf("hit %+v", v.Hit)
				// }

				// if v.Attacker != nil {
				// 	logger.Printf("attacker %+v", v.Attacker)
				// }

				if v.Hit == nil {
					// Attacker
					attackerName = fmt.Sprintf("entityId:%x", v.EntityId)
					if entity := entityMap[v.EntityId]; entity != nil {
						attackerName = entity.Name
					}
					attackSkillId = v.SkillId
				} else {
					// Defender
					targetName = fmt.Sprintf("entityId:%x", v.EntityId)
					if entity := entityMap[v.EntityId]; entity != nil {
						targetName = entity.Name
					}

					damage = v.Hit.Damage
				}

			}

			logger.Println("*", attackerName, "->", targetName, "damage", damage, "skill", attackSkillId)

			continue

		case 0x7d01:
			// combat attack res
			continue

		case 0x9091:
			// effect
			continue

		case 0xa028:
			// condition update
			continue

		case 0xa43c:
			// party window update
			continue

		case 0xaf63:
			// Packet related to designated PC
			continue

		case 0x1d4c3:
			// ngs
			continue

		case 0xfd13021:
			// walk
			continue

		case 0xf44bba3:
			// run
			continue
		}

		logger.Printf("packet op %x id %x", p.Op, p.Id)
		for i, msg := range p.Msg {
			logger.Println("* msg", i, msg.Type(), msg.String())
		}
	}
}
