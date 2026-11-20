'use strict';

const captionElement = document.querySelector('#caption');
const effectsElement = document.querySelector('#effects');
const reactionsElement = document.querySelector('#reactions');
let normalCaption = '';
let reactionTimer;

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function clearReaction() {
  clearTimeout(reactionTimer);
  effectsElement.replaceChildren();
  captionElement.textContent = normalCaption;
}

function selectCaption(selection) {
  const { captions } = data;
  const probability = captions.selection.seasonCaptionProbability;
  const useSeason = Math.random() < probability.numerator / probability.denominator;
  const scene = effectiveSelection(selection).scene;
  normalCaption = randomItem(useSeason ? captions.seasons[selection.season] : captions.scenes[scene]);
  clearReaction();
}

function addParticle(text, className, x, y) {
  const particle = document.createElement('span');
  particle.className = `particle ${className}`;
  particle.textContent = text;
  particle.style.setProperty('--x', `${x}%`);
  particle.style.setProperty('--y', `${y}%`);
  effectsElement.append(particle);
}

reactionsElement.addEventListener('click', event => {
  const button = event.target.closest('button[data-reaction]');
  if (!button || !currentSelection) return;
  clearReaction();
  const scene = data.scenes.scenes.find(item => item.id === displayedScene);
  const sleeping = scene?.sleeping === true;
  const reaction = sleeping ? 'sleep' : button.dataset.reaction;
  captionElement.textContent = randomItem(data.captions.reactions[reaction]);
  if (sleeping) {
    addParticle('♥', 'heart small', 30, 38); addParticle('♥', 'heart small', 58, 53);
    addParticle('Z', 'sleep', 42, 28); addParticle('Z', 'sleep', 67, 34);
  } else if (reaction === 'call') {
    addParticle('！', 'bubble', 65, 25);
  } else {
    const count = reaction === 'pet' ? 5 : 7;
    for (let i = 0; i < count; i++) {
      addParticle(reaction === 'pet' ? '♥' : '✦', reaction === 'pet' ? 'heart' : 'sparkle',
        16 + (i * 13) % 72, 30 + (i % 3) * 14);
    }
  }
  reactionTimer = setTimeout(clearReaction, 2800);
});
