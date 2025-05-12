import {
  BlockVolume,
  Dimension,
  Player,
  system,
  world
} from '@minecraft/server'
import { ChunkLoader } from './Chunk/ChunkLoader'

world.beforeEvents.playerBreakBlock.subscribe(ev => {
  const { block, itemStack, player } = ev
  if (itemStack?.typeId === 'minecraft:wooden_axe') {
    world.sendMessage(
      `Selected the first block! Now right-click another block to confirm selection.`
    )
    player.setDynamicProperty('block:loc', block.location)
    ev.cancel = true
  }
})

let volume

world.afterEvents.itemUse.subscribe(ev => {
  const { itemStack, source: player } = ev
  if (
    itemStack?.typeId === 'minecraft:wooden_axe' &&
    player instanceof Player
  ) {
    const head = player.getHeadLocation()
    const view = player.getViewDirection()
    const blocks = player.dimension.getBlockFromRay(head, view, {
      maxDistance: 8
    })
    if (!blocks) return
    const { block } = blocks
    player.setDynamicProperty('block:loc2', block.location)
    world.sendMessage(
      `Selected a area of blocks. Type "!help" in the chat, to get a list of commands.`
    )
    let loc1 = player.getDynamicProperty('block:loc')
    let loc2 = player.getDynamicProperty('block:loc2')
    volume = new BlockVolume(
      { x: loc1.x, y: loc1.y, z: loc1.z }, //from
      { x: loc2.x, y: loc2.y, z: loc2.z } //to
    )
  }
})

world.beforeEvents.chatSend.subscribe(async ev => {
  const { message, sender: player } = ev
  if (message.startsWith('!set ')) {
    ev.cancel = true
    const blockId = message.split(' ')[1]

    const chunks = await splitIntoChunks(volume)

    let loc1 = player.getDynamicProperty('block:loc')
    let loc2 = player.getDynamicProperty('block:loc2')

    const iteratable = volume.getBlockLocationIterator()

    let count = 0
    for (const l of iteratable) {
      count++
    }
    const chunkBlocks = getBlockAtEachChunk(loc1, loc2, player.dimension)
    chunkBlocks.forEach(block => {
      const location = player.location
      const spawnDimension = player.dimension
      const destinationDimension = player.dimension

      const destination = block.location
      const chunk = new ChunkLoader({
        x: location.x,
        y: location.y,
        z: location.z,
        baseDimension: spawnDimension,
        dimension: destinationDimension
      })
      //
      chunk.load(destination).then(async () => {
        const timeStart = Date.now()
        player.runJobStatus = false

        system.runJob(fillBlocks(player, chunks, blockId, {}, count))

        await new Promise(async r => {
          while (!player.runJobStatus) await system.waitTicks(1)
          r()
          delete player.runJobStatus
        })

        world.sendMessage(
          `Filled out ${count} blocks in ${
            (Date.now() - timeStart) / 1000
          } seconds`
        )

        chunk.unload(destination)
      })
      //
    })
  }
  if (message.startsWith('!sphere ')) {
    ev.cancel = true
    const split = message.split(' ')
    const blockId = split[1]
    const radius = parseInt(split[2])
    const hollow = split[3]
    if (radius > 30) {
      world.sendMessage(`The limit of creating sphere with a radius is 30.`)
      return
    }

    if (hollow === 'hollow') {
        
    const center = player.location
    const positions = generateSphere(radius, center, true)

      const timeStart2 = Date.now()
      player.runJobStatus = false

      system.runJob(createSphere(positions, blockId, player))

      await new Promise(async r => {
        while (!player.runJobStatus) await system.waitTicks(1)
        r()
        delete player.runJobStatus
      })

      world.sendMessage(
        `Created a ${radius} radius ${hollow} sphere with ${
          positions.length
        } blocks in ${(Date.now() - timeStart2) / 1000} seconds`
      )
    } else {
      const center = player.location
      const positions = generateSphere(radius, center, false)

      const timeStart3 = Date.now()
      player.runJobStatus = false

      system.runJob(createSphere(positions, blockId, player))

      await new Promise(async r => {
        while (!player.runJobStatus) await system.waitTicks(1)
        r()
        delete player.runJobStatus
      })

      world.sendMessage(
        `Created a ${radius} radius sphere with ${positions.length} blocks in ${
          (Date.now() - timeStart3) / 1000
        } seconds`
      )
    }
  }
})

/**
 *
 * @param {Player} player
 */
function* fillBlocks (
  player,
  chunks,
  block,
  blockFillOptions = {},
  totalBlocks
) {
  let filledBlocks = 0

  for (const chunk of chunks) {
    const blockVolume = new BlockVolume(chunk.from, chunk.to)

    player.dimension.fillBlocks(blockVolume, block, blockFillOptions)

    filledBlocks += getCubesInChunk(chunk)

    const percent = Math.floor((100 * filledBlocks) / totalBlocks)

    player.onScreenDisplay?.setActionBar(`Filling area: ${percent}% complete`)
  }
  player.runJobStatus = true
}

/**
 * Split chunks
 * @author Minato
 */
async function splitIntoChunks (bounds) {
  const MAX_BLOCKS = 32768
  let { from, to } = bounds

  let xMin = Math.min(from.x, to.x)
  let xMax = Math.max(from.x, to.x)
  let yMin = Math.min(from.y, to.y)
  let yMax = Math.max(from.y, to.y)
  let zMin = Math.min(from.z, to.z)
  let zMax = Math.max(from.z, to.z)

  let chunks = []
  let xStep = xMax - xMin + 1
  let yStep = yMax - yMin + 1
  let zStep = zMax - zMin + 1

  let totalBlocks = xStep * yStep * zStep
  if (totalBlocks <= MAX_BLOCKS) {
    chunks.push(new BlockVolume(from, to))
    return chunks
  }
  let maxStep = Math.floor(Math.cbrt(MAX_BLOCKS))
  let xChunkSize = Math.min(xStep, maxStep)
  let yChunkSize = Math.min(yStep, maxStep)
  let zChunkSize = Math.min(zStep, maxStep)

  for (let x = xMin; x <= xMax; x += xChunkSize) {
    for (let y = yMin; y <= yMax; y += yChunkSize) {
      for (let z = zMin; z <= zMax; z += zChunkSize) {
        let chunk = {
          from: { x, y, z },
          to: {
            x: Math.min(x + xChunkSize - 1, xMax),
            y: Math.min(y + yChunkSize - 1, yMax),
            z: Math.min(z + zChunkSize - 1, zMax)
          }
        }
        chunks.push(chunk)
      }
    }
  }

  return chunks
}

/**
 *
 * @param {Vector3} loc1
 * @param {Vector3} loc2
 * @param {Dimension} dimension
 * @returns {Block[]}
 */
function getBlockAtEachChunk (loc1, loc2, dimension) {
  const chunkX1 = Math.floor(loc1.x / 16)
  const chunkZ1 = Math.floor(loc1.z / 16)
  const chunkX2 = Math.floor(loc2.x / 16)
  const chunkZ2 = Math.floor(loc2.z / 16)

  const xMin = Math.min(chunkX1, chunkX2)
  const xMax = Math.max(chunkX1, chunkX2)
  const zMin = Math.min(chunkZ1, chunkZ2)
  const zMax = Math.max(chunkZ1, chunkZ2)

  const middleBlocks = []

  for (let x = xMin; x <= xMax; x++) {
    for (let z = zMin; z <= zMax; z++) {
      const middleX = x * 16 + 8
      const middleZ = z * 16 + 8
      const middleBlock = dimension.getTopmostBlock({ x: middleX, z: middleZ })
      middleBlocks.push(middleBlock)
    }
  }

  return middleBlocks
}

function getCubesInChunk (chunk) {
  const { from, to } = chunk
  const x = Math.abs(to.x - from.x) + 1
  const y = Math.abs(to.y - from.y) + 1
  const z = Math.abs(to.z - from.z) + 1

  return x * y * z
}

function generateSphere (radius, center, hollow) {
  const positions = []

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        const dist = Math.sqrt(x * x + y * y + z * z)
        if (dist <= radius && (!hollow || dist >= radius - 1)) {
          positions.push({
            x: center.x + x,
            y: center.y + y,
            z: center.z + z
          })
        }
      }
    }
  }

  return positions
}

function* createSphere (positions, blockId, player) {
  const total = positions.length
  let placed = 0

  for (const pos of positions) {
    yield player.dimension.getBlock(pos).setType(blockId)
    placed++
    const percent = Math.floor((100 * placed) / total)
    player.onScreenDisplay?.setActionBar(
      `Creating sphere: ${percent}% complete`
    )
  }

  player.runJobStatus = true
}

