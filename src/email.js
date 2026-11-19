/**
 * email.js — messages to requestors.
 *
 * WHY one email that adapts: every requestor gets an instant receipt (ticket ID,
 * owner, due date). If the request is incomplete or a rush, the SAME email says
 * so and lists exactly what's missing, so nobody has to chase them in DMs.
 */

function sendConfirmationEmail_(req, ctx) {
  if (!req.requestorEmail) return;
  var needsInfo = ctx.missing && ctx.missing.length > 0;
  var subject = (needsInfo ? '[Action needed] ' : '') + 'WiCS Marketing request received: ' + ctx.taskName;

  var parts = [];
  parts.push('<p>Hi ' + escapeHtml_(req.requestorName || 'there') + ',</p>');
  parts.push('<p>Thanks! Your marketing request is in the queue.</p>');
  parts.push(
    '<table cellpadding="4" style="border-collapse:collapse">' +
      row_('Ticket ID', ctx.taskGid) +
      row_('Request', ctx.taskName) +
      row_('Owner', ctx.ownerName || 'Marketing team') +
      row_('Due date', req.neededBy || '—') +
      row_('Priority', ctx.priority) +
      row_('Status', needsInfo ? 'Needs Info — waiting on you' : 'Intake — we\'ll pick it up soon') +
      row_('Ticket link', '<a href="' + ctx.taskUrl + '">Open in Asana</a> (marketing team members)') +
      '</table>'
  );

  if (needsInfo) {
    parts.push('<p><b>We need a bit more before we can start:</b></p><ul>' +
      ctx.missing.map(function (m) { return '<li>' + escapeHtml_(m) + '</li>'; }).join('') +
      '</ul><p>Just reply to this email with the details and quote your Ticket ID.</p>');
  }

  if (ctx.timing.rush) {
    parts.push('<p><b>Heads up — this is a rush request.</b> ' + escapeHtml_(req.type) + ' requests usually need ' +
      ctx.leadDays + ' days of lead time and this one is due in ' + ctx.timing.daysUntilDue +
      ' day(s). We\'ll do our best, but we may need to simplify the deliverable or move the date.</p>');
  }

  parts.push('<p>Questions about status or timing? Reply to this email with your Ticket ID.</p><p>— WiCS Marketing</p>');

  MailApp.sendEmail({
    to: req.requestorEmail,
    subject: subject,
    htmlBody: parts.join('\n'),
    name: 'WiCS Marketing',
  });
}

function row_(label, valueHtml) {
  return '<tr><td style="color:#666">' + label + '</td><td><b>' + valueHtml + '</b></td></tr>';
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
