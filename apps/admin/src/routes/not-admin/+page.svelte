<script lang="ts">
  let { data } = $props();
  const email = $derived(data.who.state === 'not-admin' ? data.who.email : null);
</script>

<svelte:head><title>Not an admin · Powermove</title></svelte:head>

<header class="heading">
  <h1>Not an admin</h1>
  <p>{email ? `${email} can't use the admin panel.` : "This account can't use the admin panel."}</p>
</header>
<section class="section">
  <div class="group">
    <div class="row">
      <div class="copy"><b>Use another account</b><span>Sign out, then sign in with an admin account.</span></div>
      <form method="POST" action="/sign-out"><button class="btn" type="submit">Sign out</button></form>
    </div>
  </div>
</section>
